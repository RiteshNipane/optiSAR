"""
Phase 18: Live On-Demand Region Analysis API

Replaces the "precompute everything, store in DB, app just queries it"
model with on-demand computation: the app sends a lat/lon + two date
ranges, this endpoint pulls exactly that imagery from Earth Engine
RIGHT THEN (synchronous getDownloadURL, same technique phase5 already
proved works -- no Drive export, no Task Manager, no waiting), runs
the SAME validated change-detection method from phase14 on it, and
returns polygons immediately.

WHY THIS SCALES WHEN STATEWIDE PRECOMPUTE DOESN'T: nothing is computed
in advance for the whole state. Only the one small area the user
actually taps gets processed, once, per request. No 65,000-export
problem, because there's no precompute step at all.

WHAT'S REUSED FROM THE VALIDATED 7-AOI WORK (not recomputed):
  - EVI/VV/VH per-pixel change formula (phase14)
  - GLOBAL_THRESHOLD = 4.3528 -- the exact calibrated value derived
    from pooling change scores across all 60 validated tiles. This is
    THE mechanism for "use the learning from the 7 AOIs" -- it is
    applied as a fixed constant to brand-new regions rather than
    re-derived per request (there's no population to pool from a
    single on-demand tile anyway).
  - NDBI_THRESHOLD = 0.1 driver-split logic (phase15)
  - Water occurrence masking approach (phase12f), fetched live instead
    of pre-exported.

HONEST LIMITATIONS vs. the validated pipeline (state these to the user
in the app, don't hide them):
  - NO temporal persistence filtering. The validated pipeline required
    a pixel to stay anomalous across 2+ consecutive quarters to reject
    transient cloud/shadow noise. A single baseline-vs-target snapshot
    here can't do that -- it's inherently a less-confirmed result than
    the 7 AOIs. Treat live-analysis output as "candidate detections",
    not validated findings.
  - If the user's picked dates fall in heavy cloud cover with zero
    clear Sentinel-2 images in the search window, this returns a clear
    error rather than silently guessing -- see NO_CLEAR_IMAGERY below.
  - Area is capped (MAX_BOX_KM) -- this is NOT a tool for analyzing
    arbitrarily large regions in one request.
"""

import os
import io
import math
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import rasterio
import requests
import ee
from flask import Blueprint, request, jsonify
from rasterio import features
from shapely.geometry import shape

from impact_stats import compute_impact_stats

ee.Initialize(project=os.environ.get('EE_PROJECT', 'satellite-deforestation-projct'))   # set EE_PROJECT to your own Google Cloud project

live_analysis = Blueprint('live_analysis', __name__)

TARGET_SCALE = 10
BOX_KM = 8  # default box size around the tapped point
MIN_BOX_KM = 2    # smallest side a client may request
MAX_BOX_KM = 30   # largest side; bigger boxes are split into tiles
MAX_TILE_KM = 12  # one tile must stay under Earth Engine's download size limit
DATE_WINDOW_DAYS = 30  # +/- window around each picked date to find clear imagery
CLOUD_THRESHOLD = 30

# Calibrated from the validated 7-AOI / 60-tile analysis (phase14) --
# NOT re-derived per request. This is the actual mechanism for
# "learning from the 7 AOIs".
GLOBAL_THRESHOLD = 4.3528
NDBI_THRESHOLD = 0.1
MIN_CLUSTER_SIZE = 9  # pixels, same as the validated pipeline

BLUE, GREEN, RED, NIR, VV, VH = 0, 1, 2, 3, 4, 5

# Dynamic World land-cover labels (Google's pretrained CNN, 10 m)
LC_TREES, LC_GRASS, LC_CROPS, LC_SHRUB, LC_BUILT, LC_BARE, LC_UNKNOWN = 1, 2, 4, 5, 6, 7, 255
# Afforestation = vegetation GAIN where the baseline was barren/grass/scrub and the target is trees.
# NOTE: EVI_GAIN_MIN is a heuristic -- it was NOT calibrated on the 7 validated sites.
EVI_GAIN_MIN = 0.10


def km_to_degrees(km, lat):
    """Rough conversion, fine at this scale -- 1 degree latitude is
    ~111km everywhere; longitude shrinks with cos(latitude)."""
    lat_deg = km / 111.0
    lon_deg = km / (111.0 * np.cos(np.radians(lat)))
    return lat_deg, lon_deg


def build_box(lat, lon, box_km):
    half_lat, half_lon = km_to_degrees(box_km / 2, lat)
    return ee.Geometry.Rectangle([
        lon - half_lon, lat - half_lat, lon + half_lon, lat + half_lat
    ])


def mask_s2_scl(image):
    scl = image.select('SCL')
    mask = (scl.neq(3).And(scl.neq(8)).And(
        scl.neq(9)).And(scl.neq(10)).And(scl.neq(11)))
    return image.updateMask(mask).divide(10000).copyProperties(image, ['system:time_start'])


def speckle_filter(image, radius=30):
    return image.focalMedian(radius, 'circle', 'meters').copyProperties(image, ['system:time_start'])


SR_RELIABLE_FROM = '2019-01-01'   # Sentinel-2 L2A (surface reflectance) is global in Earth Engine only from ~Dec 2018
EARLIEST_DATE = '2016-01-01'      # Dynamic World / Sentinel-1 / Sentinel-2 (L1C) are used from 2016


def mask_s2_qa60(image):
    qa = image.select('QA60')
    mask = qa.bitwiseAnd(1 << 10).eq(0).And(qa.bitwiseAnd(1 << 11).eq(0))
    return image.updateMask(mask).divide(10000).copyProperties(image, ['system:time_start'])


def _s2_collection(region, start, end, toa, cloud_max=CLOUD_THRESHOLD):
    """Cloud-masked Sentinel-2 reflectance. toa=True uses Level-1C (top-of-atmosphere) data, which is the only
    option before 2019 because surface-reflectance coverage in Earth Engine is not global yet."""
    if toa:
        return (ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
                .filterBounds(region).filterDate(start, end)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_max))
                .map(mask_s2_qa60))
    return (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(region).filterDate(start, end)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_max))
            .map(mask_s2_scl))


def build_composite(region, center_date_str, toa=False):
    """Pulls a cloud-masked S2 + speckle-filtered S1 composite centered
    on center_date_str, +/- DATE_WINDOW_DAYS. Same fusion logic as
    phase12/phase14, just computed live instead of batch-exported."""
    center = ee.Date(center_date_str)
    start = center.advance(-DATE_WINDOW_DAYS, 'day')
    end = center.advance(DATE_WINDOW_DAYS, 'day')

    s2_collection = _s2_collection(region, start, end, toa)
    if s2_collection.size().getInfo() == 0:
        return None  # caller turns this into NO_CLEAR_IMAGERY

    s2_clean = s2_collection.median().clip(region)
    s2_bands = s2_clean.select(['B2', 'B3', 'B4', 'B8']).rename(
        ['blue', 'green', 'red', 'nir'])

    s1_collection = (ee.ImageCollection('COPERNICUS/S1_GRD')
                     .filterBounds(region)
                     .filterDate(start, end)
                     .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
                     .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
                     .filter(ee.Filter.eq('instrumentMode', 'IW'))
                     .select(['VV', 'VH']))
    if s1_collection.size().getInfo() == 0:
        return None  # no radar scene in the window (can happen in the early archive)
    s1_clean = (s1_collection.map(lambda img: speckle_filter(img, radius=30))
                .median().clip(region))
    s1_bands = s1_clean.rename(['vv', 'vh'])

    s2_aligned = s2_bands.reproject(crs='EPSG:4326', scale=TARGET_SCALE)
    s1_aligned = s1_bands.reproject(crs='EPSG:4326', scale=TARGET_SCALE)

    return s2_aligned.addBands(s1_aligned).toFloat()


def build_urban_bands(region, center_date_str, toa=False):
    center = ee.Date(center_date_str)
    start = center.advance(-DATE_WINDOW_DAYS, 'day')
    end = center.advance(DATE_WINDOW_DAYS, 'day')
    name = 'COPERNICUS/S2_HARMONIZED' if toa else 'COPERNICUS/S2_SR_HARMONIZED'
    s2 = (ee.ImageCollection(name)
          .filterBounds(region).filterDate(start, end)
          .select(['B8', 'B11']))
    if s2.size().getInfo() == 0:
        return None
    return s2.median().clip(region).reproject(crs='EPSG:4326', scale=TARGET_SCALE).toFloat()


# ESA WorldCover 2021 (10 m, independently validated): used for FARMLAND extent, water/wetland and existing built-up
WC_CROPS, WC_BUILT, WC_WATER, WC_WETLAND = 40, 50, 80, 90
LC_WATER, LC_FLOODED, LC_SNOW = 0, 3, 8


def build_worldcover(region):
    wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map')
    return wc.unmask(0).clip(region).reproject(crs='EPSG:4326', scale=TARGET_SCALE).toByte()


def build_water_mask(region):
    gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence')
    water = gsw.gte(5).unmask(0)
    kernel = ee.Kernel.circle(radius=3, units='pixels')
    water_dilated = water.focal_max(kernel=kernel, iterations=1)
    return water_dilated.clip(region).toByte().rename('water_mask')


def build_landcover(region, center_date_str):
    """Dynamic World label (mode over the date window) on the same 10 m grid. Unknown = 255."""
    center = ee.Date(center_date_str)
    dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
          .filterBounds(region)
          .filterDate(center.advance(-DATE_WINDOW_DAYS, 'day'), center.advance(DATE_WINDOW_DAYS, 'day'))
          .select('label'))
    if dw.size().getInfo() == 0:
        return None
    return (dw.mode().unmask(LC_UNKNOWN).clip(region)
            .reproject(crs='EPSG:4326', scale=TARGET_SCALE).toByte())


DW_PALETTE = ['3b82f6', '22c55e', 'bef264', '7c8fd6', 'f59e0b', 'facc15', 'c084fc', 'a8a29e', 'e5e7eb']


def _landcover_overlay_url(bbox, date_str):
    """Map tiles showing only farmland for the box: ESA WorldCover 2021 cropland (Dynamic World as fallback)."""
    try:
        region = ee.Geometry.Rectangle(bbox)
        wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').clip(region)
        farm = wc.eq(WC_CROPS)
        try:   # drop cropland that has been built over since 2021 (Dynamic World built-up near the target date)
            center = ee.Date(date_str)
            dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(region)
                  .filterDate(center.advance(-DATE_WINDOW_DAYS, 'day'), center.advance(DATE_WINDOW_DAYS, 'day'))
                  .select('label'))
            if dw.size().getInfo() > 0:
                farm = farm.And(dw.mode().neq(LC_BUILT).unmask(1))
        except Exception:
            pass
        m = farm.selfMask().getMapId({'min': 0, 'max': 1, 'palette': ['f59e0b', 'f59e0b']})
        return m['tile_fetcher'].url_format
    except Exception:
        pass
    try:
        region = ee.Geometry.Rectangle(bbox)
        center = ee.Date(date_str)
        dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(region)
              .filterDate(center.advance(-DATE_WINDOW_DAYS, 'day'), center.advance(DATE_WINDOW_DAYS, 'day'))
              .select('label'))
        mode = dw.mode().clip(region)
        m = mode.updateMask(mode.eq(LC_CROPS)).getMapId({'min': 0, 'max': 8, 'palette': DW_PALETTE})  # farmland only
        return m['tile_fetcher'].url_format
    except Exception:
        return None


# ---------------------------------------------------------------------------------------------
# Seasonal-cycle check: farmland shows repeated, abrupt green-up / harvest cycles; forest stays green
# and a real clearing is a one-way drop. All three thresholds are HEURISTICS (not calibrated).
# ---------------------------------------------------------------------------------------------
SERIES_MONTHS = 24        # monthly EVI composites ending at the target date
SERIES_SCALE = 30         # metres; keeps the 24-band download small
CYCLE_MIN_AMP = 0.25      # typical high minus typical low EVI
CYCLE_MIN_SWINGS = 3      # high<->low swings in the window (3 = at least 1.5 cycles)
CYCLE_MIN_SHARP = 0.35    # biggest month-to-month step (smoothed) as a fraction of the amplitude
CYCLE_MAX_LOW = 0.35      # the 'bare' phase must get close to bare-soil EVI (forest rarely does)
CYCLE_MIN_MONTHS = 8      # months with a real observation, out of SERIES_MONTHS
CYCLE_MAX_GAP = 3         # longest run of unobserved months we are willing to interpolate over (a monsoon-long gap is not)


def _evi_image(img):
    return (img.expression('2.5 * (N - R) / (N + 6 * R - 7.5 * B + 1)',
                           {'N': img.select('B8'), 'R': img.select('B4'), 'B': img.select('B2')})
            .clamp(-1, 1).rename('evi'))


def build_evi_series(region, end_date_str, toa, months=SERIES_MONTHS):
    """months monthly-median EVI bands (m0 = the month ending at the target date, m1 = the one before ...).
    Months with no clear scene are -9999."""
    end = ee.Date(end_date_str)
    bands = []
    for i in range(months):
        col = _s2_collection(region, end.advance(-(i + 1), 'month'), end.advance(-i, 'month'), toa, cloud_max=60)
        evi = ee.Image(ee.Algorithms.If(col.size().gt(0),
                                        col.map(_evi_image).median(),
                                        ee.Image.constant(-9999).rename('evi')))
        bands.append(evi.unmask(-9999).rename(f'm{i}'))
    return ee.Image.cat(bands).clip(region).toFloat()


def _fill_gaps(x):
    """Linear interpolation of NaN months, per pixel (x is T,H,W). All-NaN pixels stay NaN."""
    T = x.shape[0]
    valid = np.isfinite(x)
    t = np.arange(T).reshape(T, 1, 1)
    prev_idx = np.maximum.accumulate(np.where(valid, t, -1), axis=0)
    next_idx = np.minimum.accumulate(np.where(valid, t, T)[::-1], axis=0)[::-1]
    pv = np.take_along_axis(x, np.clip(prev_idx, 0, T - 1), axis=0)
    nv = np.take_along_axis(x, np.clip(next_idx, 0, T - 1), axis=0)
    span = (next_idx - prev_idx).astype(float)
    with np.errstate(invalid='ignore', divide='ignore'):
        frac = np.where(span > 0, (t - prev_idx) / span, 0.0)
        out = pv + (nv - pv) * frac
    out = np.where(prev_idx < 0, nv, out)
    out = np.where(next_idx >= T, pv, out)
    out = np.where(valid, x, out)
    return np.where(valid.any(axis=0, keepdims=True), out, np.nan)


def analyze_cycles(series):
    """series: (T,H,W) chronological monthly EVI, NaN where unobserved.
    Returns {'farm_pattern': bool(H,W), 'valid': bool(H,W)}."""
    T = series.shape[0]
    n_obs = np.isfinite(series).sum(axis=0)
    gap = np.zeros(series.shape[1:], dtype=int)
    longest = np.zeros(series.shape[1:], dtype=int)
    for t in range(T):                                              # longest run of missing months
        gap = np.where(np.isfinite(series[t]), 0, gap + 1)
        longest = np.maximum(longest, gap)
    valid = (n_obs >= CYCLE_MIN_MONTHS) & (longest <= CYCLE_MAX_GAP)
    x = _fill_gaps(series)
    p = np.concatenate([x[:1], x, x[-1:]], axis=0)
    sm = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4.0                       # light smoothing
    low = np.percentile(sm, 10, axis=0)
    high = np.percentile(sm, 90, axis=0)
    amp = high - low
    hi_thr, lo_thr, mid = low + 0.6 * amp, low + 0.4 * amp, low + 0.5 * amp
    state = sm[0] > mid
    swings = np.zeros(sm.shape[1:], dtype=int)
    for t in range(1, T):                                           # hysteresis: count high<->low swings
        up = (~state) & (sm[t] > hi_thr)
        down = state & (sm[t] < lo_thr)
        swings += up.astype(int) + down.astype(int)
        state = np.where(up, True, np.where(down, False, state))
    with np.errstate(invalid='ignore', divide='ignore'):
        sharp = np.abs(np.diff(sm, axis=0)).max(axis=0) / amp
    farm = (valid & (amp >= CYCLE_MIN_AMP) & (swings >= CYCLE_MIN_SWINGS)
            & (sharp >= CYCLE_MIN_SHARP) & (low <= CYCLE_MAX_LOW))
    return {'farm_pattern': np.nan_to_num(farm, nan=False).astype(bool), 'valid': valid}


def _fit_to(arr, shape, fill=LC_UNKNOWN):
    out = np.full(shape, fill, dtype=arr.dtype)
    h, w = min(shape[0], arr.shape[0]), min(shape[1], arr.shape[1])
    out[:h, :w] = arr[:h, :w]
    return out


def download_as_array(image, region, scale=TARGET_SCALE):
    """Synchronous download -- the phase5 technique. Returns
    (array, rasterio_profile) so output polygons inherit correct
    georeferencing directly from the downloaded GeoTIFF."""
    url = image.getDownloadURL({
        'region': region, 'scale': scale, 'crs': 'EPSG:4326', 'format': 'GEO_TIFF'
    })
    resp = requests.get(url)
    resp.raise_for_status()
    with rasterio.io.MemoryFile(resp.content) as memfile:
        with memfile.open() as src:
            arr = src.read()
            profile = src.profile
    return arr, profile


def compute_evi(arr):
    blue, red, nir = arr[BLUE], arr[RED], arr[NIR]
    denom = nir + 6.0 * red - 7.5 * blue + 1.0
    with np.errstate(divide="ignore", invalid="ignore"):
        evi = 2.5 * (nir - red) / denom
    evi = np.clip(evi, -2.0, 2.0)
    evi[~np.isfinite(evi)] = np.nan
    return evi


def derive_features(arr):
    return np.stack([compute_evi(arr), arr[VV], arr[VH]], axis=0)


def compute_change_score(baseline_feat, target_feat, water_mask):
    bands, h, w = baseline_feat.shape
    baseline_flat = baseline_feat.reshape(bands, h * w).T
    valid_baseline = np.isfinite(baseline_flat).all(axis=1) & ~water_mask.reshape(h * w)
    if valid_baseline.sum() < 50:
        return None

    std = baseline_flat[valid_baseline].std(axis=0)
    std[std == 0] = 1.0

    delta = target_feat - baseline_feat
    normalized_delta = delta / std[:, None, None]
    change_score = np.sqrt(np.nansum(normalized_delta ** 2, axis=0))

    invalid = (
        ~np.isfinite(baseline_feat).all(axis=0)
        | ~np.isfinite(target_feat).all(axis=0)
        | water_mask
    )
    change_score[invalid] = np.nan
    return change_score


def _built_mask(urban_arr):
    """NDBI > threshold from the NIR/SWIR bands, or None if those bands are unavailable."""
    if urban_arr is None:
        return None
    nir, swir = urban_arr[0], urban_arr[1]
    denom = swir + nir
    ndbi = np.where(denom != 0, (swir - nir) / np.where(denom == 0, 1, denom), np.nan)
    return np.nan_to_num(ndbi, nan=-1) > NDBI_THRESHOLD


DRAWN_CLASSES = ('clearing', 'construction', 'farmland', 'afforestation')


def classify_and_vectorize(change_score, urban_arr, profile, evi_delta=None, base_lc=None, tgt_lc=None,
                           urban_base_arr=None, wc=None, farm_pat=None, farm_valid=None):
    """Flag changed pixels, then classify them. Only NEW construction is reported:
    pixels that were already built-up at baseline (land cover OR NDBI) are ignored.

    With land cover (Dynamic World) available:
      construction  -- target is built-up (land cover AND NDBI) and the baseline was not   [drawn]
      farmland      -- repeating abrupt green/bare cycles over the last 24 months (WorldCover cropland
                       is used only where the time series is unusable)                          [drawn]
      (water / wetland change -- lakes, ponds, reservoir drawdown, wet fields -- is ignored)
      afforestation -- EVI gain, baseline barren/grass/scrub -> target trees                [drawn]
      clearing      -- EVI loss where the baseline was trees/scrub                          [drawn]
      other         -- remaining loss (baseline not forest): counted, NOT drawn
    Deforestation = clearing + construction that happened on forest/scrub.
    Without land cover it falls back to a plain clearing / construction split."""
    from scipy import ndimage

    flagged = np.nan_to_num(change_score, nan=0) > GLOBAL_THRESHOLD

    structure = np.ones((3, 3), dtype=int)
    labeled, n = ndimage.label(flagged, structure=structure)
    if n > 0:
        sizes = ndimage.sum(flagged, labeled, range(1, n + 1))
        keep = np.where(sizes >= MIN_CLUSTER_SIZE)[0] + 1
        flagged = np.isin(labeled, keep)

    built_t, built_b = _built_mask(urban_arr), _built_mask(urban_base_arr)
    none = np.zeros_like(flagged, dtype=bool)

    gain = none
    if evi_delta is not None:
        gain = np.nan_to_num(evi_delta, nan=0) >= EVI_GAIN_MIN

    have_lc = base_lc is not None and tgt_lc is not None
    have_wc = wc is not None
    have_cyc = farm_pat is not None and farm_valid is not None
    extra = {}
    if have_lc:
        wet = (base_lc == LC_WATER) | (tgt_lc == LC_WATER) | (base_lc == LC_FLOODED) | (tgt_lc == LC_FLOODED)
        wet = wet | (base_lc == LC_SNOW) | (tgt_lc == LC_SNOW)      # snow/ice cover changes are seasonal, not land-use change
        if have_wc:
            wet = wet | np.isin(wc, [WC_WATER, WC_WETLAND])
        fl = flagged & ~wet                                          # water changes are not land-use change
        extra['water_ignored'] = int((flagged & wet).sum())
        farm_ref = (wc == WC_CROPS) if have_wc else ((base_lc == LC_CROPS) | (tgt_lc == LC_CROPS))
        if have_cyc:   # repeating cycles are the strongest evidence; land-cover maps only decide where the series is unusable
            farm_ref = farm_pat | (farm_ref & ~farm_valid)
            extra['pattern_farm'] = int((farm_pat & farm_valid).sum())
        if have_wc:
            extra['wc_farm'] = int(((wc == WC_CROPS) & (tgt_lc != LC_BUILT)).sum())   # cropland that is not built over now
        base_built = (base_lc == LC_BUILT) | (built_b if built_b is not None else none)
        if have_wc:
            base_built = base_built | (wc == WC_BUILT)               # built by 2021 => already existing
        tgt_built = (tgt_lc == LC_BUILT) & (built_t if built_t is not None else ~none)
        existing_built = fl & base_built                       # ignored: roofs/shadows of existing buildings
        rest = fl & ~existing_built
        construction = rest & tgt_built                             # NEW construction
        now_built = (tgt_lc == LC_BUILT) | (built_t if built_t is not None else none)
        farm = rest & ~construction & farm_ref & ~now_built         # WorldCover is a 2021 snapshot: skip land built over since
        rest2 = rest & ~construction & ~farm
        afforest = rest2 & gain & np.isin(base_lc, [LC_BARE, LC_GRASS, LC_SHRUB]) & (tgt_lc == LC_TREES)
        loss = rest2 & ~gain
        forest_base = np.isin(base_lc, [LC_TREES, LC_SHRUB])
        clearing = loss & forest_base
        other = loss & ~forest_base
        classes = [('clearing', clearing), ('construction', construction), ('farmland', farm),
                   ('afforestation', afforest), ('other', other)]
        extra['existing_built'] = int(existing_built.sum())
        extra['construction_on_forest'] = int((construction & forest_base).sum())
        for v in range(9):                                          # target land-cover mix
            extra[f'lc_{v}'] = int((tgt_lc == v).sum())
    else:
        nb = built_b if built_b is not None else none
        nt = built_t if built_t is not None else none
        loss = flagged & ~gain & ~nb
        if have_cyc:
            farm_fb = loss & farm_pat & farm_valid
            classes = [('clearing', loss & ~nt & ~farm_fb), ('construction', loss & nt & ~farm_fb), ('farmland', farm_fb)]
        else:
            classes = [('clearing', loss & ~nt), ('construction', loss & nt)]

    results, counts = [], {}
    for name, mask in classes:
        counts[name] = int(mask.sum())
        if name not in DRAWN_CLASSES or not mask.any():
            continue
        for geom, val in features.shapes(mask.astype(np.uint8), transform=profile['transform']):
            if val == 1:
                results.append({"driver_type": name, "geometry": shape(geom).__geo_interface__})
    counts.update(extra)
    return results, int(flagged.sum()), int(flagged.size), counts, have_lc


JOBS = {}
_jobs_lock = threading.Lock()


def _dims_km(w, s, e, n):
    """Width/height in km of a [west, south, east, north] box."""
    mid = (s + n) / 2
    return (e - w) * 111.0 * math.cos(math.radians(mid)), (n - s) * 111.0


def _parse_request(data):
    """-> (bbox [w,s,e,n], baseline_date, target_date). Accepts either
    {"bbox": [w,s,e,n]} or the legacy {"lat","lon","box_km"}. Raises ValueError."""
    try:
        baseline_date = data['baseline_date']
        target_date = data['target_date']
        if 'bbox' in data:
            w, s, e, n = [float(v) for v in data['bbox']]
        else:
            lat, lon = float(data['lat']), float(data['lon'])
            box_km = max(MIN_BOX_KM, min(MAX_BOX_KM, float(data.get('box_km', BOX_KM))))
            half_lat, half_lon = km_to_degrees(box_km / 2, lat)
            w, s, e, n = lon - half_lon, lat - half_lat, lon + half_lon, lat + half_lat
    except (KeyError, TypeError, ValueError):
        raise ValueError('Required: baseline_date, target_date (YYYY-MM-DD) and bbox [w,s,e,n] or lat/lon')
    if not (e > w and n > s):
        raise ValueError('bbox must be [west, south, east, north]')
    if baseline_date < EARLIEST_DATE or target_date < EARLIEST_DATE:
        raise ValueError(f'Dates must be {EARLIEST_DATE} or later.')
    wkm, hkm = _dims_km(w, s, e, n)
    if min(wkm, hkm) < MIN_BOX_KM - 0.1 or max(wkm, hkm) > MAX_BOX_KM + 0.1:
        raise ValueError(f'Box sides must be {MIN_BOX_KM}-{MAX_BOX_KM} km (got {wkm:.1f} x {hkm:.1f}).')
    return [w, s, e, n], baseline_date, target_date


def _tiles(bbox):
    """Split the box into a grid of tiles, each side <= MAX_TILE_KM."""
    w, s, e, n = bbox
    wkm, hkm = _dims_km(w, s, e, n)
    nx, ny = max(1, math.ceil(wkm / MAX_TILE_KM)), max(1, math.ceil(hkm / MAX_TILE_KM))
    tw, th = (e - w) / nx, (n - s) / ny
    return [[w + i * tw, s + j * th, w + (i + 1) * tw, s + (j + 1) * th]
            for j in range(ny) for i in range(nx)]


def _analyze_tile(region, baseline_date, target_date):
    """The validated single-tile pipeline. Returns polygons/counts or an error dict."""
    toa = baseline_date < SR_RELIABLE_FROM   # before 2019: top-of-atmosphere data for both dates, so they stay comparable
    baseline_image = build_composite(region, baseline_date, toa=toa)
    if baseline_image is None:
        return {'error': 'NO_CLEAR_IMAGERY',
                'message': f'No usable cloud-free Sentinel-1/2 imagery found within {DATE_WINDOW_DAYS} days '
                           f'of {baseline_date} for this location. Try a different date.'}
    target_image = build_composite(region, target_date, toa=toa)
    if target_image is None:
        return {'error': 'NO_CLEAR_IMAGERY',
                'message': f'No usable cloud-free Sentinel-1/2 imagery found within {DATE_WINDOW_DAYS} days '
                           f'of {target_date} for this location. Try a different date.'}

    baseline_arr, baseline_profile = download_as_array(baseline_image, region)
    target_arr, _ = download_as_array(target_image, region)
    water_arr, _ = download_as_array(build_water_mask(region), region)
    water_mask = water_arr[0].astype(bool)

    urban_img = build_urban_bands(region, target_date, toa=toa)
    urban_arr = None
    if urban_img is not None:
        urban_arr, _ = download_as_array(urban_img, region)
    urban_base_arr = None
    try:
        urban_base_img = build_urban_bands(region, baseline_date, toa=toa)
        if urban_base_img is not None:
            urban_base_arr, _ = download_as_array(urban_base_img, region)
    except Exception:
        urban_base_arr = None

    baseline_feat, target_feat = derive_features(baseline_arr), derive_features(target_arr)
    change_score = compute_change_score(baseline_feat, target_feat, water_mask)
    if change_score is None:
        return {'error': 'INSUFFICIENT_DATA', 'message': 'Too few valid pixels in this area to analyze.'}

    base_lc = tgt_lc = None
    try:
        b_img, t_img = build_landcover(region, baseline_date), build_landcover(region, target_date)
        if b_img is not None and t_img is not None:
            base_lc = _fit_to(download_as_array(b_img, region)[0][0], change_score.shape)
            tgt_lc = _fit_to(download_as_array(t_img, region)[0][0], change_score.shape)
    except Exception:
        base_lc = tgt_lc = None  # fall back to the old clearing/construction split

    wc = None
    try:
        wc = _fit_to(download_as_array(build_worldcover(region), region)[0][0], change_score.shape, fill=0)
    except Exception:
        wc = None  # fall back to Dynamic World crops for farmland

    farm_pat = farm_valid = None
    try:
        ser = download_as_array(build_evi_series(region, target_date, toa), region, scale=SERIES_SCALE)[0].astype('float32')
        ser[ser < -1.5] = np.nan                       # -9999 = no clear scene that month
        cyc = analyze_cycles(ser[::-1])                # band m0 is the newest month -> make it chronological
        up = lambda a: _fit_to(np.repeat(np.repeat(a, 3, axis=0), 3, axis=1), change_score.shape, fill=False)
        farm_pat, farm_valid = up(cyc['farm_pattern']), up(cyc['valid'])
    except Exception:
        farm_pat = farm_valid = None                   # fall back to land-cover maps only

    polygons, n_flagged, n_total, counts, have_lc = classify_and_vectorize(
        change_score, urban_arr, baseline_profile,
        evi_delta=target_feat[0] - baseline_feat[0], base_lc=base_lc, tgt_lc=tgt_lc,
        urban_base_arr=urban_base_arr, wc=wc, farm_pat=farm_pat, farm_valid=farm_valid)
    return {'polygons': polygons, 'n_flagged': n_flagged, 'n_total': n_total,
            'counts': counts, 'landcover': have_lc, 'worldcover': wc is not None, 'toa': toa,
            'cycles': farm_pat is not None}


def _run_analysis(bbox, baseline_date, target_date, progress=None):
    tiles = _tiles(bbox)

    def work(t):
        try:
            r = _analyze_tile(ee.Geometry.Rectangle(t), baseline_date, target_date)
        except Exception as ex:
            r = {'error': 'TILE_FAILED', 'message': str(ex)}
        r['bbox'] = t
        if progress:
            progress()
        return r

    with ThreadPoolExecutor(max_workers=min(3, len(tiles))) as pool:
        results = list(pool.map(work, tiles))

    ok = [r for r in results if 'polygons' in r]
    if not ok:
        first = results[0]
        return {'error': first.get('error', 'FAILED'), 'message': first.get('message', 'Analysis failed.')}

    polygons = [p for r in ok for p in r['polygons']]
    n_flagged = sum(r['n_flagged'] for r in ok)
    n_total = sum(r['n_total'] for r in ok)
    counts = {}
    for r in ok:
        for k, v in r['counts'].items():
            counts[k] = counts.get(k, 0) + v
    lc_all = all(r['landcover'] for r in ok)
    wc_all = all(r.get('worldcover') for r in ok)

    aoi_area_ha = sum(a * b * 100 for a, b in (_dims_km(*r['bbox']) for r in ok))
    to_ha = lambda c: (counts.get(c, 0) / n_total * aoi_area_ha) if n_total else 0.0
    # deforestation = clearing + construction that happened on forest/scrub (all construction if no land cover)
    loss_ha = to_ha('clearing') + (to_ha('construction') if not lc_all else to_ha('construction_on_forest'))

    impact = compute_impact_stats(
        features=[{"type": "Feature", "geometry": z["geometry"], "properties": {}}
                  for z in polygons if z["driver_type"] in ('clearing', 'construction')],
        flagged_area_ha=loss_ha,
        aoi_area_ha=aoi_area_ha,
        baseline_date=baseline_date,
        target_date=target_date,
    )
    years = impact['period_years'] or 1.0
    impact['afforested_area_ha'] = round(to_ha('afforestation'), 2)
    impact['afforestation_rate_ha_per_year'] = round(to_ha('afforestation') / years, 2)
    impact['net_change_ha'] = round(to_ha('afforestation') - loss_ha, 2)   # gain minus loss
    impact['farmland_change_ha'] = round(to_ha('farmland'), 2)
    impact['new_construction_ha'] = round(to_ha('construction'), 2)
    impact['other_change_ha'] = round(to_ha('other'), 2)
    impact['landcover_used'] = lc_all
    impact['water_ignored_ha'] = round(to_ha('water_ignored'), 2)
    impact['farmland_extent_ha'] = round(to_ha('wc_farm') if wc_all else to_ha('lc_4'), 1)                        # all cropland in the box (target date)
    impact['forest_extent_ha'] = round(to_ha('lc_1') + to_ha('lc_5'), 1)          # trees + scrub
    impact['built_extent_ha'] = round(to_ha('lc_6'), 1)
    impact['existing_built_ignored_ha'] = round(to_ha('existing_built'), 2)

    wkm, hkm = _dims_km(*bbox)
    note = ('Live single-comparison result -- not persistence-filtered like the 7 validated AOIs. '
            'Treat as a candidate detection, not a confirmed one.')
    if not all(r.get('cycles') for r in ok):
        note += ' The seasonal-cycle check was unavailable for some tiles, so farmland there relies on land-cover maps only.'
    if any(r.get('toa') for r in ok):
        note += (' The baseline is before 2019, so both dates use Sentinel-2 top-of-atmosphere data '
                 '(surface-reflectance coverage is not global before Dec 2018): results are rougher.')
    if not lc_all:
        note += ' Land-cover data was unavailable for some/all tiles, so farmland and afforestation were not classified there.'
    if len(ok) != len(tiles):
        note += f' {len(tiles) - len(ok)} tile(s) had no usable imagery and were skipped.'
    return {
        'bbox': bbox,
        'lat': (bbox[1] + bbox[3]) / 2, 'lon': (bbox[0] + bbox[2]) / 2,
        'baseline_date': baseline_date, 'target_date': target_date,
        'width_km': round(wkm, 1), 'height_km': round(hkm, 1),
        'tiles': len(tiles), 'tiles_ok': len(ok),
        'change_area_pct': round(n_flagged / n_total * 100, 4) if n_total else 0,
        'n_flagged_pixels': n_flagged,
        'class_pixels': counts,
        'landcover_tiles': _landcover_overlay_url(bbox, target_date) if lc_all else None,
        'zones': polygons,
        'impact': impact,
        'note': note,
    }


@live_analysis.route('/api/analyze', methods=['POST'])
def analyze_region():
    """Synchronous version (fine for small boxes / quick tests).
    POST {"bbox": [w,s,e,n], "baseline_date": "...", "target_date": "..."}
    or the legacy {"lat", "lon", "box_km", ...}."""
    try:
        bbox, baseline_date, target_date = _parse_request(request.get_json() or {})
    except ValueError as e:
        return jsonify({'error': 'BAD_REQUEST', 'message': str(e)}), 400
    res = _run_analysis(bbox, baseline_date, target_date)
    if 'error' in res:
        return jsonify(res), 422
    return jsonify(res)


@live_analysis.route('/api/analyze/start', methods=['POST'])
def analyze_start():
    """Starts a background job (large boxes take minutes). Poll /api/analyze/status/<job_id>."""
    try:
        bbox, baseline_date, target_date = _parse_request(request.get_json() or {})
    except ValueError as e:
        return jsonify({'error': 'BAD_REQUEST', 'message': str(e)}), 400

    total = len(_tiles(bbox))
    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        for k in [k for k, v in JOBS.items() if v['ts'] < time.time() - 3600]:
            JOBS.pop(k, None)
        JOBS[job_id] = {'status': 'running', 'done': 0, 'total': total,
                        'result': None, 'error': None, 'ts': time.time()}

    def progress():
        with _jobs_lock:
            JOBS[job_id]['done'] += 1

    def worker():
        try:
            res = _run_analysis(bbox, baseline_date, target_date, progress)
            with _jobs_lock:
                if 'error' in res:
                    JOBS[job_id].update(status='error', error=res)
                else:
                    JOBS[job_id].update(status='done', result=res)
        except Exception as ex:
            with _jobs_lock:
                JOBS[job_id].update(status='error', error={'error': 'SERVER_ERROR', 'message': str(ex)})

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'job_id': job_id, 'total': total}), 202


@live_analysis.route('/api/analyze/status/<job_id>', methods=['GET'])
def analyze_status(job_id):
    with _jobs_lock:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify({'error': 'NOT_FOUND', 'message': 'Unknown or expired job.'}), 404
        return jsonify({k: job[k] for k in ('status', 'done', 'total', 'result', 'error')})
