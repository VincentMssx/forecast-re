document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('dateStr');
    const fetchButton = document.getElementById('fetch-button');
    const prevDayButton = document.getElementById('prev-day-button');
    const nextDayButton = document.getElementById('next-day-button');
    const statusMessage = document.getElementById('status-message');
    
    const CHART_DATUM_OFFSET = 3.55;

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

    const findIntersections = (data, lineHeight) => {
        const intersections = [];
        for (let i = 0; i < data.length - 1; i++) {
            const p1 = data[i];
            const p2 = data[i + 1];

            // Check if the line crosses the segment between p1 and p2
            if ((p1.y < lineHeight && p2.y > lineHeight) || (p1.y > lineHeight && p2.y < lineHeight)) {
                // Perform linear interpolation to find the exact time of crossing
                const timeDiff = p2.x.getTime() - p1.x.getTime();
                const heightDiff = p2.y - p1.y;
                const weight = (lineHeight - p1.y) / heightDiff;
                
                const intersectionTime = new Date(p1.x.getTime() + timeDiff * weight);
                
                intersections.push({
                    x: intersectionTime,
                    y: lineHeight
                });
            }
        }
        return intersections;
    };

    const updateIntersectionAnnotations = (chart, intersections) => {
        const annotations = chart.options.plugins.annotation.annotations;

        // 1. Clear previous intersection annotations
        Object.keys(annotations).forEach(key => {
            if (key.startsWith('intersection_')) {
                delete annotations[key];
            }
        });

        // 2. Add new annotations for each intersection
        intersections.forEach((point, index) => {
            // Add the simple dot
            annotations[`intersection_dot_${index}`] = {
                type: 'point',
                xValue: point.x,
                yValue: point.y,
                backgroundColor: 'rgba(255, 255, 255, 1)',
                borderColor: 'darkred',
                borderWidth: 2,
                radius: 5,
            };
            // Add the time label
            annotations[`intersection_label_${index}`] = {
                type: 'label',
                xValue: point.x,
                yValue: point.y,
                content: point.x.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                font: { size: 12, weight: 'bold' },
                color: 'white',
                backgroundColor: 'rgba(192, 0, 0, 0.8)',
                padding: 4,
                borderRadius: 4,
                yAdjust: -20, // Position the label above the dot
            };
        });
    };

    const windArrowPlugin = {
        id: 'windArrowPlugin',
        afterDatasetsDraw(chart, args, options) {
            const { ctx, scales: { x } } = chart;
            const arrowSets = options.arrowSets || [];
            
            ctx.save();
            
            const headLength = 8, headBase = 4, tailLength = 10, rowSpacing = 20;

            arrowSets.forEach((arrowSet, setIndex) => {
                const targetDataset = chart.data.datasets.find(d => d.label === arrowSet.label);
                if (!targetDataset || !chart.isDatasetVisible(chart.data.datasets.indexOf(targetDataset))) return;

                arrowSet.observations.forEach(obs => {
                    if (obs.time && obs.degree !== null) {
                        const xPos = x.getPixelForValue(new Date(obs.time));
                        const yPos = chart.chartArea.bottom + 80 + (setIndex * rowSpacing);

                        if (xPos < chart.chartArea.left || xPos > chart.chartArea.right) return;

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
        const ctx = document.getElementById('weatherChart').getContext('2d');
        if (weatherChart) weatherChart.destroy();
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

        if (hourlyForecast.windspeed_10m_gfs_seamless) {
            datasets.push({
                label: 'GFS Wind Speed',
                data: hourlyForecast.time.map((t, i) => ({ x: new Date(t), y: hourlyForecast.windspeed_10m_gfs_seamless[i] })),
                borderColor: gfsColor, backgroundColor: gfsColor, tension: 0.1, pointRadius: 1,
            });
            arrowSets[0].observations = hourlyForecast.time.map((t, i) => ({
                time: t, degree: hourlyForecast.winddirection_10m_gfs_seamless[i]
            }));
        }

        if (hourlyForecast.windspeed_10m_arome_france) {
            datasets.push({
                label: 'AROME Wind Speed',
                data: hourlyForecast.time.map((t, i) => ({ x: new Date(t), y: hourlyForecast.windspeed_10m_arome_france[i] })),
                borderColor: aromeColor, backgroundColor: aromeColor, tension: 0.1, pointRadius: 1,
            });
            arrowSets[1].observations = hourlyForecast.time.map((t, i) => ({
                time: t, degree: hourlyForecast.winddirection_10m_arome_france[i]
            }));
        }

        if (hourlyObservations && hourlyObservations.observations.length > 0) {
            const validObservations = hourlyObservations.observations.filter(obs => obs.time && obs.wind_speed_kmh !== null);
            datasets.push({
                label: 'Observation',
                data: validObservations.map(obs => ({ x: new Date(obs.time), y: obs.wind_speed_kmh })),
                borderColor: observationsColor, backgroundColor: observationsColor, tension: 0.1, pointRadius: 1,
            });

            const hourlyFiltered = [];
            const hours = new Set();
            for (const obs of validObservations) {
                const hour = new Date(obs.time).getHours();
                if (!hours.has(hour)) {
                    hourlyFiltered.push(obs);
                    hours.add(hour);
                }
            }
            arrowSets[2].observations = hourlyFiltered.map(obs => ({ time: obs.time, degree: obs.wind_direction_degrees }));
        }

        weatherChart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { bottom: 80 } },
                scales: {
                    x: {
                        type: 'time', time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
                        title: { display: true, text: 'Time of Day' },
                        min: `${date}T00:00:00`, max: `${date}T23:59:59`,
                    },
                    y: { title: { display: true, text: 'Wind Speed (km/h)' }, beginAtZero: true }
                },
                plugins: {
                    windArrowPlugin: { arrowSets },
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
            y: tidesData.hourly.sea_level_height_msl[i] + CHART_DATUM_OFFSET
        }));

        const initialLineHeight = 3.0; // Starting height for the line

        const finalAnnotations = {
            zeroLine: {
                type: 'line',
                yMin: 0,
                yMax: 0,
                borderColor: 'rgb(54, 162, 235)',
                borderWidth: 2,
                borderDash: [6, 6],
                label: { content: 'Hydrographic Zero', enabled: true, position: 'start', backgroundColor: 'rgba(54, 162, 235, 0.8)' }
            },
            // The DRAGGABLE red line
            draggableLine: {
                type: 'line',
                yMin: initialLineHeight,
                yMax: initialLineHeight,
                borderColor: 'red',
                borderWidth: 2,
                draggable: true, // MAKE THE LINE DRAGGABLE
                // This event fires after the user finishes dragging
                onDragEnd: function(event) {
                    const chart = event.chart;
                    const newLineHeight = event.subject.options.yMin; // Get the new height
                    const intersections = findIntersections(tidePoints, newLineHeight);
                    updateIntersectionAnnotations(chart, intersections);
                    chart.update('none'); // Update without animation
                }
            }
        };


        const todayString = new Date().toISOString().split('T')[0];
        // 2. If it's today, ADD the currentTimePoint to our 'finalAnnotations' object.
        if (date === todayString) {
            const now = new Date();
            const currentHour = now.getHours();
            
            // Handle the edge case for the last hour of the day (23:00)
            if (tidePoints[currentHour] && currentHour < 23) {
                const point1 = tidePoints[currentHour];
                const point2 = tidePoints[currentHour + 1];
                
                const minutesFraction = now.getMinutes() / 60;
                const interpolatedHeight = point1.y + (point2.y - point1.y) * minutesFraction;
                
                // Add the new point to our existing object
                finalAnnotations.currentTimePoint = {
                    type: 'point',
                    xValue: now,
                    yValue: interpolatedHeight,
                    backgroundColor: 'rgba(255, 0, 0, 0.8)',
                    borderColor: 'darkred',
                    borderWidth: 2,
                    radius: 6
                };
            }
        }
        // --- END OF CORRECTION ---
        
        tideChart = new Chart(tideCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Tide Height',
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
                    y: { 
                        title: { display: true, text: 'Tide Height / Chart Datum (m)' },
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: `Tide Evolution for ${date}`, font: { size: 16 } },
                    tooltip: {
                        intersect: false,
                        mode: 'index',
                        callbacks: {
                            label: (context) => `Height: ${context.parsed.y.toFixed(2)} m`
                        }
                    },
                    // 3. Use the 'finalAnnotations' object that contains everything.
                    annotation: {
                        annotations: finalAnnotations
                    }
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
});