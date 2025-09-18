import requests
import logging
import re
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from datetime import datetime
from bs4 import BeautifulSoup, Tag
from typing import Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Mount the 'static' directory to serve frontend files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Open-Meteo API URL
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
HISTORICAL_API_URL = "https://archive-api.open-meteo.com/v1/archive"
MARINE_API_URL = "https://marine-api.open-meteo.com/v1/marine"
LATITUDE = 46.244  # Forecast coordinates
LONGITUDE = -1.561  # Forecast coordinates


@app.get("/api/forecast")
def get_weather_forecast(
    date: str = Query(..., description="Start date in YYYY-MM-DD format")
):
    """
    Fetches weather data for GFS and AROME models from Open-Meteo.
    """
    logger.info(f"Fetching weather for {date}")

    params: dict[str, str] = {
        "latitude": str(LATITUDE),
        "longitude": str(LONGITUDE),
        "start_date": date,
        "end_date": date,
        "hourly": "windspeed_10m,winddirection_10m",
        "timezone": "auto",
        "models": "arome_france,gfs_seamless",
        "wind_speed_unit": "kn",
    }

    try:
        response = requests.get(OPEN_METEO_URL, params=params)
        response.raise_for_status()
        forecast_data = response.json()
        logger.info("Successfully fetched data from Open-Meteo")

        return forecast_data

    except requests.exceptions.RequestException as e:
        logger.error(f"API request failed: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error contacting Open-Meteo API: {e}"
        )
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")
        raise HTTPException(
            status_code=500, detail="An internal server error occurred."
        )


@app.get("/")
async def read_index():
    """
    Serves the main HTML file.
    """
    return FileResponse("static/index.html")


@app.get("/api/observations")
def get_observations_hourly(
    date: str = Query(..., description="Date for ground truth in YYYY-MM-DD format")
) -> Dict[str, Any]:
    """
    Scrapes the Meteociel website (specific station) to get hourly observed wind data for a given date.
    The station ID (code2) is hardcoded to 7311 for Ile de Ré - Saint-Clément-des-Baleines.
    """
    station_code = 7311

    try:
        # Parse the input date string (e.g., "2023-10-27")
        dt_obj = datetime.strptime(date, "%Y-%m-%d")
        jour = dt_obj.day
        # Meteociel's month parameter is 0-indexed (January=0, December=11)
        mois = dt_obj.month - 1
        annee = dt_obj.year
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Please use YYYY-MM-DD."
        )

    # Construct the dynamic Meteociel URL for the specified date
    METEOCIEL_URL = (
        f"https://www.meteociel.fr/temps-reel/obs_villes.php?"
        f"code2={station_code}&jour2={jour}&mois2={mois}&annee2={annee}&affint=2"
    )

    logger.info(f"Attempting to scrape hourly ground truth data from {METEOCIEL_URL}")

    # Add a User-Agent header to mimic a real browser to avoid being blocked.
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    try:
        response = requests.get(
            METEOCIEL_URL, headers=headers, timeout=15
        )  # Increased timeout
        response.raise_for_status()  # Raise an exception for bad status codes
        soup = BeautifulSoup(response.content, "lxml")  # Parse HTML with lxml parser

        # Find the specific table for hourly observations.
        # Based on your provided soup.txt, this table has bgcolor="#EBFAF7".
        hourly_table = soup.find("table", {"bgcolor": "#EBFAF7"})

        # Ensure hourly_table is a Tag before using find_all
        if not isinstance(hourly_table, Tag):
            logger.warning(
                f"Hourly observation table (bgcolor='#EBFAF7') not found for {date} on Meteociel. "
                "This might mean no data is available for this date, or the page structure has changed."
            )
            # Return an empty list if the table isn't found, indicating no data for the date.
            return {"date": date, "observations": []}

        rows = hourly_table.find_all("tr")
        ground_truth_data: list[dict[str, Any]] = []

        # Regex to extract wind direction text and degrees from the 'onmouseover' attribute of the image.
        # Example: 'Direction : </i>Ouest <small>(260°)</small>'
        wind_direction_pattern = re.compile(
            r"Direction\s*:\s*</i>([^<]+)<small>\(([^°]+)°\)"
        )

        # Regex to extract mean wind speed and optional rafales from text like "36 km/h (44 km/h)".
        # Group 1 captures the main speed, Group 2 (optional) captures the rafale speed.
        wind_speed_pattern = re.compile(
            r"(\d+(?:\.\d+)?)\s*km/h\s*(?:\((\d+(?:\.\d+)?)\s*km/h\))?"
        )

        # The first row (index 0) in the hourly_table is the header. Data rows start from index 1.
        if len(rows) > 1:
            for row in rows[1:]:
                # Ensure cells is always a list of Tag, even if find_all returns a ResultSet or unknown type
                if isinstance(row, Tag):
                    cells = list(row.find_all("td"))
                else:
                    continue

                # Ensure it's a valid data row (not an empty separator or malformed row).
                # A full data row should have at least 11 cells for time and wind data.
                if len(cells) >= 11 and cells[0].get_text(strip=True):

                    time_raw = cells[0].get_text(strip=True)  # e.g., "12h36"

                    wind_speed_kmh = None
                    wind_direction_degrees = None

                    # Extract wind speed and rafales from the 11th cell (index 10)
                    wind_speed_text_content = cells[10].get_text(strip=True)
                    speed_match = wind_speed_pattern.search(wind_speed_text_content)
                    if speed_match:
                        try:
                            wind_speed_kmh = float(speed_match.group(1))
                        except ValueError:
                            logger.warning(
                                f"Scraper: Could not convert wind speed/rafales from '{wind_speed_text_content}'."
                            )

                    # Extract wind direction from the 10th cell (index 9) which contains an <img> tag
                    wind_img_tag = None
                    if isinstance(cells[9], Tag):
                        wind_img_tag = cells[9].find("img")
                    if (
                        isinstance(wind_img_tag, Tag)
                        and "onmouseover" in wind_img_tag.attrs
                    ):
                        onmouseover_text = wind_img_tag["onmouseover"]
                        dir_match = wind_direction_pattern.search(str(onmouseover_text))
                        try:
                            wind_direction_degrees = (
                                float(dir_match.group(2).strip()) if dir_match else None
                            )
                        except ValueError:
                            logger.warning(
                                f"Scraper: Could not convert wind direction degrees from '{dir_match.group(2) if dir_match else ''}'."
                            )

                    # Format the time into ISO-like string (YYYY-MM-DDTHH:MM) for Chart.js
                    # e.g., "12h36" becomes "12:36" -> "2023-10-27T12:36"
                    try:
                        # 1. Split the time string (e.g., "7h36" or "12h") at the 'h'.
                        parts = time_raw.split("h")

                        # 2. Convert the hour part to an integer.
                        hour_int = int(parts[0])

                        # 3. Get the minute part. If it exists, convert it; otherwise, default to 0.
                        minute_int = int(parts[1]) if len(parts) > 1 and parts[1] else 0

                        # 4. Use f-string formatting to ensure two digits for both hour and minute.
                        #    e.g., hour=7, minute=36 -> "07:36"
                        #    e.g., hour=12, minute=0 -> "12:00"
                        time_formatted = f"{hour_int:02d}:{minute_int:02d}"

                        # 5. Create the final, standard ISO-like string.
                        full_datetime_str = f"{date}T{time_formatted}"

                    except (ValueError, IndexError) as e:
                        logger.warning(
                            f"Scraper: Could not format time string '{time_raw}': {e}"
                        )
                        full_datetime_str = None

                    if wind_speed_kmh is not None:
                        ground_truth_data.append(
                            {
                                "time": full_datetime_str,
                                "wind_speed_kmh": wind_speed_kmh / 1.852,  # Convert km/h to knots
                                "wind_direction_degrees": wind_direction_degrees,
                            }
                        )

                    ground_truth_data.sort(key=lambda item: item["time"])

        logger.info(f"Scraped {len(ground_truth_data)} hourly observations for {date}.")
        observations: Dict[str, Any] = {"date": date, "observations": ground_truth_data}
        # print(f"{observations}")
        return observations

    except requests.exceptions.RequestException as e:
        logger.error(f"Scraping failed: Could not fetch the page for {date}. {e}")
        raise HTTPException(
            status_code=503, detail=f"Failed to connect to Meteociel for {date}: {e}"
        )
    except Exception as e:
        logger.error(
            f"An unexpected error occurred during scraping for {date}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"An internal server error occurred during scraping for {date}.",
        )


@app.get("/api/tides")
def get_tides(
    date: str = Query(..., description="Date for tide data in YYYY-MM-DD format")
) -> Dict[str, Any]:
    """
    Fetches tide data from Open-Meteo.
    """
    logger.info(f"Fetching tide data for {date}")

    params: dict[str, str] = {
        "latitude": str(LATITUDE),
        "longitude": str(LONGITUDE),
        "start_date": date,
        "end_date": date,
        "hourly": "sea_level_height_msl",
        "timezone": "auto",
    }

    try:
        response = requests.get(MARINE_API_URL, params=params)
        response.raise_for_status()
        tide_data = response.json()
        logger.info("Successfully fetched tide data from Open-Meteo")

        return tide_data

    except requests.exceptions.RequestException as e:
        logger.error(f"API request failed: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error contacting Open-Meteo Marine API: {e}"
        )
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")
        raise HTTPException(
            status_code=500, detail="An internal server error occurred."
        )
