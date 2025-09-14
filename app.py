import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Mount the 'static' directory to serve frontend files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Open-Meteo API URL
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast?"
LATITUDE = 46.244
LONGITUDE = -1.561

@app.get("/api/weather")
def get_weather_forecast(
    start_date: str = Query(..., description="Start date in YYYY-MM-DD format"),
    end_date: str = Query(..., description="End date in YYYY-MM-DD format")
):
    """
    Fetches weather data for GFS and AROME models from Open-Meteo.
    """
    logger.info(f"Fetching weather for lat={LATITUDE}, lon={LONGITUDE} from {start_date} to {end_date}")
    
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": "windspeed_10m,winddirection_10m",
        "model": "gfs, arome",
        "timezone": "auto",
        "models": ["arome_france", "gfs_seamless"]
    }

    try:
        response = requests.get(OPEN_METEO_URL, params=params)
        # response = requests.get("https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m")
        response.raise_for_status()
        data = response.json()
        print(data)
        logger.info("Successfully fetched data from Open-Meteo")
        return data

    except requests.exceptions.RequestException as e:
        logger.error(f"API request failed: {e}")
        raise HTTPException(status_code=500, detail=f"Error contacting Open-Meteo API: {e}")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")
        raise HTTPException(status_code=500, detail="An internal server error occurred.")


@app.get("/")
async def read_index():
    """
    Serves the main HTML file.
    """
    return FileResponse('static/index.html')