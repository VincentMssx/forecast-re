document.addEventListener('DOMContentLoaded', () => {
    // Update references: remove lat/lon, add date inputs
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const fetchButton = document.getElementById('fetch-button');
    const statusMessage = document.getElementById('status-message');
    const ctx = document.getElementById('weatherChart').getContext('2d');
    
    let weatherChart;

    // --- Helper function to format dates as YYYY-MM-DD ---
    const formatDate = (date) => {
        return date.toISOString().split('T')[0];
    };

    // --- Set default date values ---
    const today = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(today.getDate() + 7);
    startDateInput.value = formatDate(today);
    endDateInput.value = formatDate(sevenDaysFromNow);

    const fetchForecast = async () => {
        // Read dates from the inputs
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!startDate || !endDate) {
            statusMessage.textContent = "Please select a start and end date.";
            return;
        }

        statusMessage.textContent = "Fetching forecast...";
        fetchButton.disabled = true;

        try {
            // Update the fetch URL to use date parameters
            const response = await fetch(`/api/weather?start_date=${startDate}&end_date=${endDate}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Failed to fetch weather data.");
            }
            const data = await response.json();
            console.log("Data from backend:", data); // Good for debugging
            
            statusMessage.textContent = "";
            renderChart(data.hourly);
            renderWindArrows(data.hourly); // Call the new arrow rendering function
        } catch (error) {
            console.error("Error:", error);
            statusMessage.textContent = `Error: ${error.message}.`;
        } finally {
            fetchButton.disabled = false;
        }
    };

    const renderWindArrows = (hourlyData) => {
        const container = document.getElementById('wind-direction-container');
        container.innerHTML = ''; // Clear previous arrows

        // We'll use GFS for direction as it's globally available
        if (!hourlyData || !hourlyData.winddirection_10m_gfs_seamless) {
            container.textContent = 'Wind direction data not available.';
            return;
        }

        const directions = hourlyData.winddirection_10m_gfs_seamless;

        directions.forEach(degree => {
            const arrow = document.createElement('span');
            arrow.className = 'wind-arrow';
            arrow.textContent = '↑'; // The arrow character (points North by default)
            
            // Apply CSS rotation. North is 0°, so the arrow points up.
            arrow.style.transform = `rotate(${degree}deg)`;
            
            // Add a tooltip to show the exact degree on hover
            arrow.title = `${degree}°`;
            
            container.appendChild(arrow);
        });
    };

    const renderChart = (hourlyData) => {
        if (weatherChart) {
            weatherChart.destroy();
        }

        if (!hourlyData || !hourlyData.time) {
            statusMessage.textContent = "No forecast data received.";
            return;
        }

        const datasets = [];

        // --- Wind SPEED Datasets ONLY ---
        if (hourlyData.windspeed_10m_gfs_seamless) {
            datasets.push({
                label: 'GFS Wind Speed (km/h)',
                data: hourlyData.windspeed_10m_gfs_seamless,
                borderColor: 'rgba(54, 162, 235, 1)',
                yAxisID: 'y-speed',
                tension: 0.1
            });
        }
        if (hourlyData.windspeed_10m_arome_france) {
            datasets.push({
                label: 'AROME Wind Speed (km/h)',
                data: hourlyData.windspeed_10m_arome_france,
                borderColor: 'rgba(255, 99, 132, 1)',
                yAxisID: 'y-speed',
                borderDash: [5, 5]
            });
        }

        if (datasets.length === 0) {
            // Keep the error message, but the arrows might still render if that data exists
            statusMessage.textContent = "No wind speed data available for the selected location.";
            return;
        }

        weatherChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: hourlyData.time.map(t => new Date(t)),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { /* ... same as before ... */ },
                    'y-speed': {
                        position: 'left',
                        title: { display: true, text: 'Wind Speed (km/h)' },
                        beginAtZero: true
                    }
                    // We REMOVED the 'y-direction' scale as it's no longer on the chart
                },
                plugins: { /* ... same as before ... */ }
            }
        });
    };

    // Add event listeners to update forecast when dates change
    fetchButton.addEventListener('click', fetchForecast);
    startDateInput.addEventListener('change', fetchForecast);
    endDateInput.addEventListener('change', fetchForecast);

    // Initial fetch on page load
    fetchForecast();
});