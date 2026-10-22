import ee
from datetime import date

AGB_ASSET = "NASA/ORNL/biomass_carbon_density/v1"  # band 'agb' = carbon density, Mg C/ha, 300 m, ~2010
CARBON_FRACTION = 0.47                              # IPCC default: biomass = carbon / 0.47
MAX_POLYS = 5000                                    # keeps the EE request size sane


def _years_between(d0, d1):
    a, b = date.fromisoformat(d0), date.fromisoformat(d1)
    return max((b - a).days / 365.25, 1e-6)


def compute_impact_stats(features, flagged_area_ha, aoi_area_ha,
                         baseline_date, target_date):
    """
    features         : list of GeoJSON Feature dicts (vectorized flagged polygons)
    flagged_area_ha  : flagged area in hectares
    aoi_area_ha      : analysed box area in hectares
    """
    years = _years_between(baseline_date, target_date)

    stats = {
        "deforested_area_ha": round(flagged_area_ha, 2),
        "deforestation_pct_of_aoi": round(100 * flagged_area_ha / aoi_area_ha, 3) if aoi_area_ha else None,
        "period_years": round(years, 2),
        "deforestation_rate_ha_per_year": round(flagged_area_ha / years, 2),
        "deforestation_rate_pct_per_year": round(100 * flagged_area_ha / aoi_area_ha / years, 4) if aoi_area_ha else None,
        "biomass_loss_tonnes": None,
        "mean_biomass_density_t_per_ha": None,
    }

    if not features:
        stats["biomass_loss_tonnes"] = 0.0
        stats["mean_biomass_density_t_per_ha"] = 0.0
        return stats

    if len(features) > MAX_POLYS:
        stats["biomass_truncated"] = True  # biomass uses the first MAX_POLYS polygons only
    try:
        polys = [f["geometry"]["coordinates"] for f in features[:MAX_POLYS]
                 if f["geometry"]["type"] == "Polygon"]
        geom = ee.Geometry.MultiPolygon(polys, proj="EPSG:4326", geodesic=False)

        # carbon (Mg C/ha) -> biomass (t/ha)
        biomass_density = (ee.ImageCollection(AGB_ASSET).select("agb")
                           .mosaic().divide(CARBON_FRACTION))
        area_ha = ee.Image.pixelArea().divide(10000)

        loss_img = biomass_density.multiply(area_ha).rename("loss")
        total = loss_img.reduceRegion(
            reducer=ee.Reducer.sum(), geometry=geom, scale=30,
            maxPixels=1e9, bestEffort=True
        ).get("loss").getInfo()

        mean_d = biomass_density.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=geom, scale=30,
            maxPixels=1e9, bestEffort=True
        ).get("agb").getInfo()

        if total is not None:
            stats["biomass_loss_tonnes"] = round(total, 1)
        if mean_d is not None:
            stats["mean_biomass_density_t_per_ha"] = round(mean_d, 1)
    except Exception as e:
        stats["biomass_error"] = str(e)  # deforestation numbers still returned

    return stats
