document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('dateStr');
    const fetchButton = document.getElementById('fetch-button');
    const prevDayButton = document.getElementById('prev-day-button');
    const nextDayButton = document.getElementById('next-day-button');
    const statusMessage = document.getElementById('status-message');
    
    const CHART_DATUM_OFFSET = 3.55;

    let weatherChart, tideChart, windDirectionChart;
    let lastFetchedData = {};
    let wasMobile = window.innerWidth < 768;

    const formatDate = (date) => date.toISOString().split('T')[0];

    const changeDate = (days) => {
        const currentDate = new Date(dateInput.value);
        currentDate.setDate(currentDate.getDate() + days);
        dateInput.value = formatDate(currentDate);
        fetchForecast();
    };

    const todayStr = formatDate(new Date());
    dateInput.value = todayStr;

    const findIntersections = (data, lineHeight) => {
        const intersections = [];
        for (let i = 0; i < data.length - 1; i++) {
            const p1 = data[i];
            const p2 = data[i + 1];
            if ((p1.y < lineHeight && p2.y > lineHeight) || (p1.y > lineHeight && p2.y < lineHeight)) {
                const timeDiff = p2.x.getTime() - p1.x.getTime();
                const heightDiff = p2.y - p1.y;
                const weight = (lineHeight - p1.y) / heightDiff;
                const intersectionTime = new Date(p1.x.getTime() + timeDiff * weight);
                intersections.push({ x: intersectionTime, y: lineHeight });
            }
        }
        return intersections;
    };

    const updateIntersectionAnnotations = (chart, intersections) => {
        const annotations = chart.options.plugins.annotation.annotations;
        Object.keys(annotations).forEach(key => {
            if (key.startsWith('intersection_')) delete annotations[key];
        });
        intersections.forEach((point, index) => {
            annotations[`intersection_dot_${index}`] = {
                type: 'point', xValue: point.x, yValue: point.y, backgroundColor: 'rgba(255, 255, 255, 1)',
                borderColor: 'darkred', borderWidth: 2, radius: 5,
            };
            annotations[`intersection_label_${index}`] = {
                type: 'label', xValue: point.x, yValue: point.y, content: point.x.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                font: { size: 12, weight: 'bold' }, color: 'white', backgroundColor: 'rgba(192, 0, 0, 0.8)',
                padding: 4, borderRadius: 4, yAdjust: -20,
            };
        });
    };

    const windArrowPlugin = {
        id: 'windArrowPlugin',
        afterDatasetsDraw(chart, args, options) {
            const { ctx, scales: { x } } = chart;
            const arrowSets = options.arrowSets || [];
            const visibleArrowSets = arrowSets.filter(set => set.observations.length > 0);
            if (visibleArrowSets.length === 0) return;

            const headLength = 8, headBase = 4, tailLength = 10;
            const chartHeight = 100;
            const rowHeight = chartHeight / visibleArrowSets.length;

            visibleArrowSets.forEach((arrowSet, setIndex) => {
                arrowSet.observations.forEach(obs => {
                    if (obs.time && obs.degree !== null) {
                        ctx.save();
                        const xPos = x.getPixelForValue(new Date(obs.time));
                        const yPos = chart.chartArea.top + (rowHeight * (setIndex + 0.5));
                        if (xPos < chart.chartArea.left || xPos > chart.chartArea.right) {
                            ctx.restore();
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
                        ctx.restore();
                    }
                });
            });
        }
    };
    Chart.register(windArrowPlugin);

    const fetchForecast = async () => {
        const date = dateInput.value;
        if (!date) { statusMessage.textContent = "Please select a date."; return; }
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
            lastFetchedData = { date, forecastData, observationsData, tidesData };
            statusMessage.textContent = "";
            renderChart(date, forecastData.hourly, observationsData);
            renderWindDirectionChart(date, forecastData.hourly, observationsData);
            renderTideChart(date, tidesData);
        } catch (error) {
            console.error("Error:", error);
            statusMessage.textContent = `Error: ${error.message}.`;
        } finally {
            fetchButton.disabled = false;
        }
    };
    
    const renderWindDirectionChart = (date, hourlyForecast, hourlyObservations) => {
        const ctx = document.getElementById('windDirectionChart').getContext('2d');
        if (windDirectionChart) windDirectionChart.destroy();
        const gfsColor = 'rgba(47, 51, 175, 1)';
        const aromeColor = 'rgba(224, 111, 31, 1)';
        const observationsColor = 'rgba(0, 150, 0, 1)';
        const arrowSets = [
            { label: 'GFS', color: gfsColor, observations: [] },
            { label: 'AROME', color: aromeColor, observations: [] },
            { label: 'Observation', color: observationsColor, observations: [] }
        ];
        if (hourlyForecast.winddirection_10m_gfs_seamless) {
            arrowSets[0].observations = hourlyForecast.time.map((t, i) => ({ time: t, degree: hourlyForecast.winddirection_10m_gfs_seamless[i] }));
        }
        if (hourlyForecast.winddirection_10m_arome_france) {
            arrowSets[1].observations = hourlyForecast.time.map((t, i) => ({ time: t, degree: hourlyForecast.winddirection_10m_arome_france[i] }));
        }
        if (hourlyObservations && hourlyObservations.observations.length > 0) {
            arrowSets[2].observations = hourlyObservations.observations
                .filter(obs => obs.time && obs.wind_direction_degrees !== null)
                .filter(obs => new Date(obs.time).getMinutes() === 0) 
                .map(obs => ({ time: obs.time, degree: obs.wind_direction_degrees }));
        }
        windDirectionChart = new Chart(ctx, {
            type: 'line', data: { datasets: [] }, options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 10, right: 50, left: 50 } },
                scales: {
                    y: { display: false },
                    x: {
                        type: 'time', time: { unit: 'hour' }, min: `${date}T00:00:00`, max: `${date}T23:59:59`,
                        ticks: { display: false }, grid: { display: false },
                        afterFit: (axis) => {
                            if (weatherChart) {
                                const weatherChartXAxis = weatherChart.scales.x;
                                axis.width = weatherChartXAxis.width;
                                axis.left = weatherChartXAxis.left;
                                axis.right = weatherChartXAxis.right;
                            }
                        }
                    }
                },
                plugins: {
                    windArrowPlugin: { arrowSets }, legend: { display: false }, tooltip: { enabled: false },
                    title: { display: true, text: 'Wind Direction' }
                }
            }
        });
    };

    const renderChart = (date, hourlyForecast, hourlyObservations) => {
        const ctx = document.getElementById('weatherChart').getContext('2d');
        if (weatherChart) weatherChart.destroy();
        if (!hourlyForecast || !hourlyForecast.time) { statusMessage.textContent = "No forecast data received."; return; }
        const isMobile = window.innerWidth < 768;
        const gfsColor = 'rgba(47, 51, 175, 1)';
        const aromeColor = 'rgba(224, 111, 31, 1)';
        const observationsColor = 'rgba(0, 150, 0, 1)';
        const datasets = [];
        if (hourlyForecast.windspeed_10m_gfs_seamless) {
            datasets.push({ label: 'GFS Wind Speed', data: hourlyForecast.time.map((t, i) => ({ x: new Date(t), y: hourlyForecast.windspeed_10m_gfs_seamless[i] })), borderColor: gfsColor, backgroundColor: gfsColor, tension: 0.1, pointRadius: 1 });
        }
        if (hourlyForecast.windspeed_10m_arome_france) {
            datasets.push({ label: 'AROME Wind Speed', data: hourlyForecast.time.map((t, i) => ({ x: new Date(t), y: hourlyForecast.windspeed_10m_arome_france[i] })), borderColor: aromeColor, backgroundColor: aromeColor, tension: 0.1, pointRadius: 1 });
        }
        if (hourlyObservations && hourlyObservations.observations.length > 0) {
            const validObservations = hourlyObservations.observations.filter(obs => obs.time && obs.wind_speed_kmh !== null);
            datasets.push({ label: 'Observation', data: validObservations.map(obs => ({ x: new Date(obs.time), y: obs.wind_speed_kmh })), borderColor: observationsColor, backgroundColor: observationsColor, tension: 0.1, pointRadius: 1 });
        }
        weatherChart = new Chart(ctx, {
            type: 'line', data: { datasets }, options: {
                responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10, right: 50, left: 50 } },
                scales: {
                    x: { type: 'time', time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } }, title: { display: true, text: 'Time of Day' }, min: `${date}T00:00:00`, max: `${date}T23:59:59` },
                    y: { title: { display: true, text: 'Wind Speed (knt)' }, beginAtZero: true }
                },
                plugins: {
                    tooltip: { mode: 'index', intersect: false },
                    legend: { position: isMobile ? 'bottom' : 'top', labels: { boxWidth: isMobile ? 15 : 40 } },
                    title: { display: true, text: 'Wind Speed' }
                }
            }
        });
    };

    const renderTideChart = (date, tidesData) => {
        const tideCtx = document.getElementById('tideChart').getContext('2d');
        if (tideChart) tideChart.destroy();
        if (!tidesData || !tidesData.hourly || !tidesData.hourly.time) return;
        const tidePoints = tidesData.hourly.time.map((t, i) => ({ x: new Date(t), y: tidesData.hourly.sea_level_height_msl[i] + CHART_DATUM_OFFSET }));
        const isMobile = window.innerWidth < 768;
        const initialLineHeight = 3.0;
        const finalAnnotations = {
            zeroLine: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgb(54, 162, 235)', borderWidth: 2, borderDash: [6, 6], label: { content: 'Hydrographic Zero', enabled: true, position: 'start', backgroundColor: 'rgba(54, 162, 235, 0.8)' } },
            draggableLine: { 
                type: 'line', 
                yMin: initialLineHeight, 
                yMax: initialLineHeight, 
                borderColor: 'red', 
                borderWidth: isMobile ? 4 : 2, 
                draggable: isMobile, 
                className: 'draggable-line',
                onDragEnd: function(event) {
                    const chart = event.chart; 
                    const newLineHeight = event.subject.options.yMin;
                    const intersections = findIntersections(tidePoints, newLineHeight);
                    updateIntersectionAnnotations(chart, intersections);
                    chart.update('none');
                }
            }
        };
        const todayString = new Date().toISOString().split('T')[0];
        if (date === todayString) {
            const now = new Date(); const currentHour = now.getHours();
            if (tidePoints[currentHour] && currentHour < 23) {
                const point1 = tidePoints[currentHour]; const point2 = tidePoints[currentHour + 1];
                const minutesFraction = now.getMinutes() / 60;
                const interpolatedHeight = point1.y + (point2.y - point1.y) * minutesFraction;
                finalAnnotations.currentTimePoint = { type: 'point', xValue: now, yValue: interpolatedHeight, backgroundColor: 'rgba(255, 0, 0, 0.8)', borderColor: 'darkred', borderWidth: 2, radius: 6 };
            }
        }
        tideChart = new Chart(tideCtx, {
            type: 'line', data: { datasets: [{ label: 'Tide Height', data: tidePoints, borderColor: 'rgba(50, 100, 200, 1)', backgroundColor: 'rgba(100, 150, 255, 0.5)', tension: 0.4, fill: 'start', pointRadius: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: 'time', time: { unit: 'hour' }, min: `${date}T00:00:00`, max: `${date}T23:59:59` },
                    y: { title: { display: true, text: 'Tide Height / Chart Datum (m)' }, beginAtZero: true }
                },
                plugins: {
                    legend: { display: false }, title: { display: true, text: `Tide Evolution for ${date}`, font: { size: 16 } },
                    tooltip: { intersect: false, mode: 'index', callbacks: { label: (context) => `Height: ${context.parsed.y.toFixed(2)} m` } },
                    annotation: { annotations: finalAnnotations }
                }
            }
        });
        const initialIntersections = findIntersections(tidePoints, initialLineHeight);
        updateIntersectionAnnotations(tideChart, initialIntersections);
        tideChart.update('none');
    };
    
    fetchButton.addEventListener('click', fetchForecast);
    prevDayButton.addEventListener('click', () => changeDate(-1));
    nextDayButton.addEventListener('click', () => changeDate(1));
    fetchForecast();

    let resizeTimeout;
    function handleResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const isMobileNow = window.innerWidth < 768;
            if (isMobileNow !== wasMobile) {
                wasMobile = isMobileNow;
                if (lastFetchedData.forecastData) {
                    console.log(`Breakpoint crossed! Re-rendering for ${isMobileNow ? 'mobile' : 'desktop'}.`);
                    renderChart(lastFetchedData.date, lastFetchedData.forecastData.hourly, lastFetchedData.observationsData);
                    renderWindDirectionChart(lastFetchedData.date, lastFetchedData.forecastData.hourly, lastFetchedData.observationsData);
                    renderTideChart(lastFetchedData.date, lastFetchedData.tidesData);
                }
            }
        }, 250);
    }
    window.addEventListener('resize', handleResize);
});