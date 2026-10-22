# OptiSAR: Automated Satellite Data Fusion Pipeline for Environment Monitoring

A mobile app and API that fuse optical (Sentinel-2) and radar (Sentinel-1) imagery to detect land-cover change anywhere in India
and report its impact: forest loss, new construction, farmland change, afforestation and estimated biomass loss.

## How it works
1. **Fusion:** EVI (Sentinel-2) + VV/VH backscatter (Sentinel-1) are stacked at 10 m around a baseline and a target date.
2. **Change score:** per-pixel normalised difference, flagged above a fixed threshold (4.3528) calibrated on 60 tiles from 7 Maharashtra areas.
3. **Filters:** minimum cluster size, water/wetland/snow masking.
4. **Classification:** Dynamic World land cover, ESA WorldCover and a 24-month seasonal-cycle check separate
   clearing, new construction (existing buildings ignored), farmland and afforestation.
5. **Impact:** deforested area, loss rate, net change, estimated biomass loss.

Large boxes (up to 30 km per side) are split into tiles and run as background jobs.

## Repository layout
```
backend/   app.py (server), phase18_live_analysis_api.py + impact_stats.py (the pipeline); phase6_backend_app_v2.py is the optional
           database version for stored results
mobile/    React Native (Expo) app: App.js
```
(The earlier research and validation scripts, phase2 to phase17, can be added under `research/`.)

## Run the backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
earthengine authenticate                                 # one-time Google Earth Engine login
export EE_PROJECT=your-google-cloud-project              # Windows: set EE_PROJECT=...
python app.py                                            # serves on 0.0.0.0:5000 (no database needed)
# optional stored-results API: copy .env.example to .env, set DB_URI, run phase6_backend_app_v2.py
```
Key endpoints: `POST /api/analyze/start`, `GET /api/analyze/status/<job_id>`, `POST /api/analyze` (synchronous), `GET /api/health`.

## Run the app
```bash
npx create-expo-app@latest optisar-app --template blank
cd optisar-app
npx expo install react-native-webview
# copy mobile/App.js over the generated App.js, set API_BASE_URL to your PC's LAN IP
npx expo start
```
Phone and PC must be on the same WiFi; allow ports 5000 (Flask) and 8081 (Expo) in the firewall.

## Status and limitations
- The detection threshold was calibrated and checked only by manual spot checks on Maharashtra sites (Western Ghats / Mumbai region).
  No statistical accuracy (precision / recall) has been computed. Elsewhere in India, treat results as candidate detections.
- The farmland-cycle and afforestation thresholds are heuristics and uncalibrated. Afforestation cannot tell new forest from plantations.
- Before 2019 the app uses Sentinel-2 top-of-atmosphere data and the archive is sparse; monsoon cloud limits imagery.
- ESA WorldCover is a 2021 snapshot; the biomass map is a 2010, 300 m estimate.
- The district list is mixed-vintage and misses some recently created districts.
- The app has no authentication.

## Data sources and credits
Copernicus Sentinel-1 and Sentinel-2, Google Dynamic World, ESA WorldCover, JRC Global Surface Water, NASA/ORNL biomass carbon density,
Hansen Global Forest Change, all via Google Earth Engine. District points were generated from
[udit-001/india-maps-data](https://github.com/udit-001/india-maps-data) (check its licence before redistributing).
