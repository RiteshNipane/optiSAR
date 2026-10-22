"""Minimal server for the mobile app: live analysis only. No database needed.

    python app.py          # serves on 0.0.0.0:5000 so a phone on the same WiFi can reach it
"""
from flask import Flask, jsonify

from phase18_live_analysis_api import live_analysis

app = Flask(__name__)
app.register_blueprint(live_analysis)


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'OptiSAR API is running'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
