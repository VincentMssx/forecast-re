document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const fetchButton = document.getElementById('fetch-button');
    const statusMessage = document.getElementById('status-message');
    const ctx = document.getElementById('weatherChart').getContext('2d');
    
    let weatherChart;

    const formatDate = (date) => date.toISOString().split('T')[0];

    const todayStr = formatDate(new Date());
    startDateInput.value = todayStr;
    endDateInput.value = todayStr;

    // --- (The windArrowPlugin code remains exactly the same as the previous version) ---
    const windArrowPlugin = {
        id: 'windArrowPlugin',
        afterDatasetsDraw(chart, args, options) {
            const { ctx, scales: { x } } = chart;
            const arrowSets = options.arrowSets || [];
            
            ctx.save();
            
            const headLength = 8;
            const headBase = 4;
            const tailLength = 10;
            const rowSpacing = 20;

            arrowSets.forEach((arrowSet, setIndex) => {
                const targetDataset = chart.data.datasets.find(d => d.label === arrowSet.label);
                if (!targetDataset || !chart.isDatasetVisible(targetDataset.index)) {
                    return;
                }
                arrowSet.observations.forEach(obs => {
                    if (obs.time && obs.degree !== null) {
                        const xPos = x.getPixelForValue(new Date(obs.time));
                        const yPos = chart.chartArea.bottom + 35 + (setIndex * rowSpacing);

                        if (xPos < chart.chartArea.left || xPos > chart.chartArea.right) {
                            return;
                        }
                        ctx.translate(xPos, yPos);
                        ctx.rotate(obs.degree * Math.PI / 180);
                        
                        ctx.beginPath();
                        ctx.moveTo(0, -headLength);
                        ctx.lineTo(headBase, 0);
                        ctx.lineTo(-headBase, 0);
                        ctx.closePath();
                        ctx.fillStyle = arrowSet.color;
                        ctx.fill();

                        ctx.beginPath();
                        ctx.moveTo(0, 0);
                        ctx.lineTo(0, tailLength);
                        ctx.strokeStyle = arrowSet.color;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                        
                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                    }
                });
            });

            ctx.restore();
        }
    };
    Chart.register(windArrowPlugin);

    const fetchForecast = async () => {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!startDate || !endDate) {
            statusMessage.textContent = "Please select a start and end date.";
            return;
        }

        statusMessage.textContent = "Fetching all data...";
        fetchButton.disabled = true;

        try {
            const [forecastResponse, groundTruthResponse] = await Promise.all([
                fetch(`/api/weather?start_date=${startDate}&end_date=${endDate}`),
                fetch(`/api/groundtruth_hourly?date_str=${startDate}`)
            ]);

            if (!forecastResponse.ok) throw new Error('Failed to fetch forecast data.');
            if (!groundTruthResponse.ok) throw new Error('Failed to fetch ground truth data.');
            const forecastData = await forecastResponse.json();
            const groundTruthData = await groundTruthResponse.json();
            console.log(forecastData)
            statusMessage.textContent = "";
            renderChart(forecastData.hourly, groundTruthData);

        } catch (error) {
            console.error("Error:", error);
            statusMessage.textContent = `Error: ${error.message}.`;
        } finally {
            fetchButton.disabled = false;
        }
    };

    const renderChart = (hourlyForecast, hourlyGroundTruth) => {
        if (weatherChart) {
            weatherChart.destroy();
        }
        if (!hourlyForecast || !hourlyForecast.time) {
            statusMessage.textContent = "No forecast data received.";
            return;
        }

        const gfsColor = 'rgba(47, 51, 175, 1)';
        const aromeColor = 'rgba(224, 111, 31, 1)';
        const groundTruthColor = 'rgba(0, 150, 0, 1)';

        const datasets = [];
        const arrowSets = [];

        // --- Forecast Data (no changes here) ---
        if (hourlyForecast.windspeed_10m_gfs_seamless) {
            datasets.push({
                label: 'GFS Wind Speed',
                data: hourlyForecast.windspeed_10m_gfs_seamless,
                borderColor: gfsColor, tension: 0.1, pointRadius: 1,
            });
            arrowSets.push({
                label: 'GFS Wind Speed', color: gfsColor,
                observations: hourlyForecast.time.map((t, i) => ({
                    time: t, degree: hourlyForecast.winddirection_10m_gfs_seamless[i]
                }))
            });
        }
        if (hourlyForecast.windspeed_10m_arome_france) {
            datasets.push({
                label: 'AROME Wind Speed',
                data: hourlyForecast.windspeed_10m_arome_france,
                borderColor: aromeColor, tension: 0.1, pointRadius: 1,
            });
            arrowSets.push({
                label: 'AROME Wind Speed', color: aromeColor,
                observations: hourlyForecast.time.map((t, i) => ({
                    time: t, degree: hourlyForecast.winddirection_10m_arome_france[i]
                }))
            });
        }

        // --- Ground Truth Data ---
        if (hourlyGroundTruth && hourlyGroundTruth.observations.length > 0) {
            console.log(hourlyGroundTruth.observations.length)
            // --- FIX: Filter out any observation that has null data before processing ---
            const validObservations = hourlyGroundTruth.observations.filter(obs => 
                obs.time !== null && 
                obs.wind_speed_kmh !== null && 
                obs.wind_direction_degrees !== null
            );

            // Now, use the filtered 'validObservations' array to build the chart data
            datasets.push({
                type: 'scatter',
                label: 'Observation',
                data: validObservations.map(obs => ({
                    x: new Date(obs.time),
                    y: obs.wind_speed_kmh
                })),
                backgroundColor: groundTruthColor,
                radius: 4,
            });
            arrowSets.push({
                label: 'Observation',
                color: groundTruthColor,
                observations: validObservations.map(obs => ({
                    time: obs.time,
                    degree: obs.wind_direction_degrees
                }))
            });
        }

        weatherChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: hourlyForecast.time.map(t => new Date(t)),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        bottom: 80
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'hour',
                            displayFormats: {
                                hour: 'HH:mm'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Time of Day'
                        },
                        // --- THIS IS THE FIX ---
                        // Force the axis to show the entire selected start date
                        min: `${startDateInput.value}T00:00:00`,
                        max: `${startDateInput.value}T23:59:59`,
                        // --- END OF FIX ---
                    },
                    y: {
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Wind Speed (km/h)'
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    windArrowPlugin: {
                        arrowSets: arrowSets
                    },
                    tooltip: {}
                }
            }
        });
    };

    fetchButton.addEventListener('click', fetchForecast);
    fetchForecast();
});