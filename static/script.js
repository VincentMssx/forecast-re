document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('dateStr');
    const fetchButton = document.getElementById('fetch-button');
    const prevDayButton = document.getElementById('prev-day-button');
    const nextDayButton = document.getElementById('next-day-button');
    const statusMessage = document.getElementById('status-message');
    const ctx = document.getElementById('weatherChart').getContext('2d');
    
    let weatherChart, tideChart;

    const formatDate = (date) => date.toISOString().split('T')[0];

    const changeDate = (days) => {
        const currentDate = new Date(dateInput.value);
        currentDate.setDate(currentDate.getDate() + days);
        dateInput.value = formatDate(currentDate);
        fetchForecast();
    };

    const todayStr = formatDate(new Date());
    dateInput.value = todayStr;

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
                if (!targetDataset || !chart.isDatasetVisible(chart.data.datasets.indexOf(targetDataset))) {
                    return;
                }
                arrowSet.observations.forEach(obs => {
                    if (obs.time && obs.degree !== null) {
                        const xPos = x.getPixelForValue(new Date(obs.time));
                        const yPos = chart.chartArea.bottom + 80 + (setIndex * rowSpacing);

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
        const date = dateInput.value;

        if (!date) {    
            statusMessage.textContent = "Please select a date.";
            return;
        }

        statusMessage.textContent = "Fetching all data...";
        fetchButton.disabled = true;

        try {
            const [forecastResponse, observationsResponse, tidesResponse] = await Promise.all([
                fetch(`/api/forecast?date=${date}`),
                fetch(`/api/observations?date=${date}`),
                fetch(`/api/tides?date=${date}`)
            ]);

            if (!forecastResponse.ok) throw new Error('Failed to fetch forecast data.');
            if (!observationsResponse.ok) throw new Error('Failed to fetch observations data.');
            if (!tidesResponse.ok) throw new Error('Failed to fetch tides data.');

            const forecastData = await forecastResponse.json();
            const observationsData = await observationsResponse.json();
            const tidesData = await tidesResponse.json();

            console.log("Forecast data:", forecastData);
            console.log("Observations data:", observationsResponse);
            console.log("Tides data:", tidesData);

            statusMessage.textContent = "";
            renderChart(date, forecastData.hourly, observationsData);
            renderTideChart(date, tidesData);

        } catch (error) {
            console.error("Error:", error);
            statusMessage.textContent = `Error: ${error.message}.`;
        } finally {
            fetchButton.disabled = false;
        }
    };

    const renderChart = (date, hourlyForecast, hourlyObservations) => {
    if (weatherChart) {
        weatherChart.destroy();
    }

    if (!hourlyForecast || !hourlyForecast.time) {
        statusMessage.textContent = "No forecast data received.";
        return;
    }

    const gfsColor = 'rgba(47, 51, 175, 1)';
    const aromeColor = 'rgba(224, 111, 31, 1)';
    const observationsColor = 'rgba(0, 150, 0, 1)';

    const datasets = [];
    const arrowSets = [
        { label: 'GFS Wind Speed', color: gfsColor, observations: [] },
        { label: 'AROME Wind Speed', color: aromeColor, observations: [] },
        { label: 'Observation', color: observationsColor, observations: [] }
    ];

    // --- GFS Forecast Data ---
    const gfsDataset = {
        label: 'GFS Wind Speed',
        data: [],
        borderColor: gfsColor,
        backgroundColor: gfsColor,
        tension: 0.1,
        pointRadius: 1,
    };
    if (hourlyForecast.windspeed_10m_gfs_seamless) {
        gfsDataset.data = hourlyForecast.time.map((t, i) => ({ x: new Date(t), y: hourlyForecast.windspeed_10m_gfs_seamless[i] }));
        arrowSets[0].observations = hourlyForecast.time.map((t, i) => ({
            time: t, degree: hourlyForecast.winddirection_10m_gfs_seamless[i]
        }));
    }
    datasets.push(gfsDataset);

    // --- AROME Forecast Data ---
    const aromeDataset = {
        label: 'AROME Wind Speed',
        data: [],
        borderColor: aromeColor, 
        backgroundColor: aromeColor,
        tension: 0.1, 
        pointRadius: 1,
    };
    if (hourlyForecast.windspeed_10m_arome_france) {
        aromeDataset.data = hourlyForecast.time.map((t, i) => ({ x: new Date(t), y: hourlyForecast.windspeed_10m_arome_france[i] }));
        arrowSets[1].observations = hourlyForecast.time.map((t, i) => ({
            time: t, degree: hourlyForecast.winddirection_10m_arome_france[i]
        }));
    }
    datasets.push(aromeDataset);

    // --- Ground Truth Data ---
    const observationDataset = {
        type: 'line',
        label: 'Observation',
        data: [],
        borderColor: observationsColor,
        backgroundColor: observationsColor,
        tension: 0.1,
        pointRadius: 1,
    };
    if (hourlyObservations && hourlyObservations.observations.length > 0) {
        const validObservations = hourlyObservations.observations.filter(obs => 
            obs.time !== null && 
            obs.wind_speed_kmh !== null && 
            obs.wind_direction_degrees !== null
        );

        const hourlyObservationsFiltered = [];
        const hours = new Set();
        for (const obs of validObservations) {
            const hour = new Date(obs.time).getHours();
            if (!hours.has(hour)) {
                hourlyObservationsFiltered.push(obs);
                hours.add(hour);
            }
        }

        observationDataset.data = validObservations.map(obs => ({
            x: new Date(obs.time),
            y: obs.wind_speed_kmh
        }));
        arrowSets[2].observations = hourlyObservationsFiltered.map(obs => ({
            time: obs.time,
            degree: obs.wind_direction_degrees
        }));
    }
    datasets.push(observationDataset);

    weatherChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hourlyForecast.time.map(t => new Date(t)),
            datasets: datasets
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            layout: { padding: { bottom: 80 } },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
                    title: { display: true, text: 'Time of Day' },
                    min: `${date}T00:00:00`,
                    max: `${date}T23:59:59`,
                },
                y: {
                    title: { display: true, text: 'Wind Speed (km/h)' },
                    beginAtZero: true
                }
            },
            plugins: {
                windArrowPlugin: { arrowSets: arrowSets },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
};

    const renderTideChart = (date, tidesData) => {
        const tideCtx = document.getElementById('tideChart').getContext('2d');
        if (tideChart) tideChart.destroy();
        if (!tidesData || !tidesData.hourly || !tidesData.hourly.time) return;

        const tidePoints = tidesData.hourly.time.map((t, i) => ({
            x: new Date(t),
            y: tidesData.hourly.sea_level_height_msl[i]
        }));
        
        tideChart = new Chart(tideCtx, {
            type: 'line',
            data: {
                datasets: [{
                    data: tidePoints,
                    borderColor: 'rgba(50, 100, 200, 1)',
                    backgroundColor: 'rgba(100, 150, 255, 0.5)',
                    tension: 0.4, fill: 'start', pointRadius: 0,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time', time: { unit: 'hour' },
                        min: `${date}T00:00:00`, max: `${date}T23:59:59`,
                    },
                    y: { title: { display: true, text: 'Sea Level (m)' } }
                },
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: `Tide Evolution for ${date}`, font: { size: 16 } }
                }
            }
        });
    };

    fetchButton.addEventListener('click', fetchForecast);
    prevDayButton.addEventListener('click', () => changeDate(-1));
    nextDayButton.addEventListener('click', () => changeDate(1));

    fetchForecast();
});