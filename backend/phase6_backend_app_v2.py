"""
Phase 6 (v2): Flask Backend API -- updated for Maharashtra results

Changes from the original:
  - ChangeZone model gains driver_type, aoi_name, tile_idx columns
    (run phase17_schema_migration.sql against the DB first, or these
    columns won't exist and every query will fail).
  - to_dict() serializes the three new fields.
  - /api/change-zones supports two new optional filters:
      ?aoi_name=sgnp_aarey
      ?driver_type=clearing   (or construction)
    in addition to the existing region_id / alert_only / limit.
  - /api/regions now also reports how many change zones exist per
    region, since with 7 regions instead of 1 that summary is more
    useful than just listing names.

Everything else (health check, single-zone detail endpoint, DB
connection handling) is unchanged from the original.
"""

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geometry
from geoalchemy2.shape import to_shape
import json
import os

try:                                  # optional: load backend/.env
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from phase18_live_analysis_api import live_analysis

# ============================================================
# Config -- the database URL now comes from the DB_URI environment variable.
# ============================================================
DB_URI = os.environ['DB_URI']   # set it in backend/.env or your shell; never commit credentials

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = DB_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
app.register_blueprint(live_analysis)


# ============================================================
# Models
# ============================================================
class Region(db.Model):
    __tablename__ = 'regions'
    region_id = db.Column(db.Integer, primary_key=True)
    region_name = db.Column(db.String(100), nullable=False)
    country = db.Column(db.String(100))
    boundary = db.Column(Geometry('POLYGON', srid=4326))
    created_at = db.Column(db.DateTime)


class SatelliteImage(db.Model):
    __tablename__ = 'satellite_images'
    image_id = db.Column(db.Integer, primary_key=True)
    region_id = db.Column(db.Integer, db.ForeignKey('regions.region_id'))
    tile_geometry = db.Column(Geometry('POLYGON', srid=4326), nullable=False)
    capture_start = db.Column(db.Date, nullable=False)
    capture_end = db.Column(db.Date, nullable=False)
    source = db.Column(db.String(50))
    scale_meters = db.Column(db.Integer)
    created_at = db.Column(db.DateTime)


class ChangeZone(db.Model):
    __tablename__ = 'change_zones'
    change_id = db.Column(db.Integer, primary_key=True)
    region_id = db.Column(db.Integer, db.ForeignKey('regions.region_id'))
    period_a_image_id = db.Column(
        db.Integer, db.ForeignKey('satellite_images.image_id'))
    period_b_image_id = db.Column(
        db.Integer, db.ForeignKey('satellite_images.image_id'))
    change_geometry = db.Column(
        Geometry('MULTIPOLYGON', srid=4326), nullable=False)
    change_area_pct = db.Column(db.Numeric(6, 3))
    confidence_score = db.Column(db.Numeric(5, 4))
    patch_pixel_count = db.Column(db.Integer)
    detected_at = db.Column(db.DateTime)
    alert_triggered = db.Column(db.Boolean)
    model_version = db.Column(db.String(50))
    # New columns (phase17_schema_migration.sql) -- Maharashtra
    # results span multiple AOIs/tiles and two driver categories,
    # neither of which existed for the single-tile Rondônia demo.
    driver_type = db.Column(db.String(20))
    aoi_name = db.Column(db.String(50))
    tile_idx = db.Column(db.String(10))

    def to_dict(self):
        geom_shape = to_shape(self.change_geometry)
        return {
            'change_id': self.change_id,
            'region_id': self.region_id,
            'aoi_name': self.aoi_name,
            'tile_idx': self.tile_idx,
            'driver_type': self.driver_type,
            'change_area_pct': float(self.change_area_pct) if self.change_area_pct else None,
            'confidence_score': float(self.confidence_score) if self.confidence_score else None,
            'patch_pixel_count': self.patch_pixel_count,
            'detected_at': self.detected_at.isoformat() if self.detected_at else None,
            'alert_triggered': self.alert_triggered,
            'model_version': self.model_version,
            'geometry_geojson': json.loads(
                json.dumps(geom_shape.__geo_interface__)
            )
        }


# ============================================================
# Endpoints
# ============================================================
class HistoricalLoss(db.Model):
    __tablename__ = 'historical_loss'
    id = db.Column(db.Integer, primary_key=True)
    aoi_name = db.Column(db.String(50), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    hectares_lost = db.Column(db.Numeric(10, 2), nullable=False)
    source = db.Column(db.String(50))


@app.route('/api/historical-loss', methods=['GET'])
def get_historical_loss():
    """
    Decade-scale annual forest loss trend per AOI, from Hansen Global
    Forest Change (NOT the custom anomaly pipeline -- see phase18's
    docstring for why these are two different data sources).
    ?aoi_name=sgnp_aarey (required)
    """
    aoi_name = request.args.get('aoi_name', type=str)
    if not aoi_name:
        return jsonify({'error': 'aoi_name query parameter is required'}), 400

    records = (HistoricalLoss.query
               .filter_by(aoi_name=aoi_name)
               .order_by(HistoricalLoss.year.asc())
               .all())

    return jsonify({
        'aoi_name': aoi_name,
        'source': 'hansen_gfc',
        'results': [
            {'year': r.year, 'hectares_lost': float(r.hectares_lost)}
            for r in records
        ]
    })


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Deforestation monitoring API is running'})


@app.route('/api/change-zones', methods=['GET'])
def get_change_zones():
    """
    List detected change zones. Supports optional filters:
    ?region_id=1
    ?aoi_name=sgnp_aarey
    ?driver_type=clearing        (or construction)
    ?alert_only=true
    ?limit=20
    """
    query = ChangeZone.query

    region_id = request.args.get('region_id', type=int)
    if region_id:
        query = query.filter_by(region_id=region_id)

    aoi_name = request.args.get('aoi_name', type=str)
    if aoi_name:
        query = query.filter_by(aoi_name=aoi_name)

    driver_type = request.args.get('driver_type', type=str)
    if driver_type:
        query = query.filter_by(driver_type=driver_type)

    alert_only = request.args.get('alert_only', 'false').lower() == 'true'
    if alert_only:
        query = query.filter_by(alert_triggered=True)

    limit = request.args.get('limit', default=50, type=int)
    zones = query.order_by(ChangeZone.detected_at.desc()).limit(limit).all()

    return jsonify({
        'count': len(zones),
        'results': [z.to_dict() for z in zones]
    })


@app.route('/api/change-zones/<int:change_id>', methods=['GET'])
def get_change_zone_detail(change_id):
    zone = ChangeZone.query.get_or_404(change_id)
    return jsonify(zone.to_dict())


@app.route('/api/regions', methods=['GET'])
def get_regions():
    regions = Region.query.all()
    results = []
    for r in regions:
        zone_count = ChangeZone.query.filter_by(region_id=r.region_id).count()
        results.append({
            'region_id': r.region_id,
            'region_name': r.region_name,
            'country': r.country,
            'change_zone_count': zone_count,
        })
    return jsonify({
        'count': len(results),
        'results': results
    })


if __name__ == '__main__':
    # host='0.0.0.0' is required for the mobile app to reach this server --
    # 127.0.0.1 (the default) only accepts connections from the same
    # machine, which excludes a phone on the same WiFi network.
    app.run(host='0.0.0.0', debug=True, port=5000)
