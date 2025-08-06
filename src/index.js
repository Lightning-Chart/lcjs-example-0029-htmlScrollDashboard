/**
 * Lightning-fast Line Chart visualization over multiple channels that progress on the same X Axis
 */

const lcjs = require('@lightningchart/lcjs')
const xydata = require('@lightningchart/xydata')

// NOTE: Assuming predefined number of stacked channels.
const SIGNALS = new Array(20).fill(0).map((_, i) => ({
    title: `Ch ${i + 1}`,
}))
const DEFAULT_X_RANGE_MS = 10 * 1000
const DASHBOARD_HEIGHT = 1400
const dataPointsPerSecond = 1000 // 1000 Hz

const { lightningChart, emptyLine, AxisTickStrategies, AxisScrollStrategies, UIOrigins, UIDraggingModes, emptyFill, Themes, DataSetXY } =
    lcjs

const { createProgressiveFunctionGenerator } = xydata

const exampleContainer = document.getElementById('chart') || document.body
const chartContainer = document.createElement('div')
exampleContainer.append(chartContainer)
chartContainer.style.width = '100%'
chartContainer.style.height = `${DASHBOARD_HEIGHT}px`
chartContainer.style.display = 'flex'
chartContainer.style.flexDirection = 'column'

const lc = lightningChart({
            resourcesBaseUrl: new URL(document.head.baseURI).origin + new URL(document.head.baseURI).pathname + 'resources/',
        })
const chart = lc
    .ChartXY({
        legend: { visible: false },
        container: chartContainer,
        theme: Themes[new URLSearchParams(window.location.search).get('theme') || 'darkGold'] || undefined,
    })
    .setTitle(`Multi-channel real-time monitoring (${SIGNALS.length} chs, 1000 Hz)`)
    .setCursorMode('show-nearest')

const axisX = chart
    .getDefaultAxisX()
    .setTickStrategy(AxisTickStrategies.Time)
    .setScrollStrategy(AxisScrollStrategies.scrolling)
    .setDefaultInterval((state) => ({ end: state.dataMax, start: (state.dataMax ?? 0) - DEFAULT_X_RANGE_MS, stopAxisAfter: false }))

// Single data set with shared timestamps
const dataSet = new DataSetXY({
    schema: {
        x: {
            auto: {
                step: 1000 / dataPointsPerSecond,
            },
        },
        ...Object.fromEntries(Array.from({ length: SIGNALS.length }, (_, i) => [`y${i}`, { pattern: null }])),
    },
}).setMaxSampleCount(20_000)

chart.getDefaultAxisY().dispose()
const channels = SIGNALS.map((signal, iSignal) => {
    const iStack = SIGNALS.length - (iSignal + 1)
    const axisY = chart
        .addAxisY({ iStack })
        .setTickStrategy(AxisTickStrategies.Empty)
        .setTitle(`Ch ${SIGNALS.length - iSignal}`)
        .setTitleRotation(0)
        .setMargins(iStack > 0 ? 3 : 0, iStack < SIGNALS.length - 1 ? 3 : 0)
        .setStrokeStyle(emptyLine)

    const series = chart
        .addLineSeries({
            automaticColorIndex: iSignal,
            yAxis: axisY,
        })
        // Use -1 thickness for best performance, especially on low end devices like mobile / laptops.
        .setStrokeStyle((style) => style.setThickness(-1))
        .setClipping(false)
        .setDataSet(dataSet, { x: 'x', y: `y${iSignal}` })

    return { series, axisY }
})

// Add LCJS user interface button for resetting view.
const buttonReset = chart
    .addUIElement()
    .setText('Reset')
    .setPosition({ x: 0, y: 0 })
    .setOrigin(UIOrigins.LeftBottom)
    .setMargin({ left: 4, bottom: 4 })
    .setDraggingMode(UIDraggingModes.notDraggable)
buttonReset.addEventListener('click', (event) => {
    const xMax = channels[0].series.getXMax()
    axisX.setInterval({ start: xMax - DEFAULT_X_RANGE_MS, end: xMax, stopAxisAfter: false })
    channels.forEach((channel) => channel.axisY.fit())
})

// Define unique signals that will be used for channels.
const signals = [
    { length: 400 * Math.PI, func: (x) => Math.sin(x / 200) },
    { length: 400 * Math.PI, func: (x) => Math.cos(x / 200) },
    {
        length: 800 * Math.PI,
        func: (x) => Math.cos(x / 400) + Math.sin(x / 200),
    },
    {
        length: 800 * Math.PI,
        func: (x) => Math.sin(x / 100) + Math.cos(x / 400),
    },
    {
        length: 800 * Math.PI,
        func: (x) => Math.sin(x / 200) * Math.cos(x / 400),
    },
    { length: 1800 * Math.PI, func: (x) => Math.cos(x / 900) },
    { length: 3200 * Math.PI, func: (x) => Math.sin(x / 1600) },
    {
        length: 2600 * Math.PI,
        func: (x) => Math.sin(x / 400) * Math.cos(x / 1300),
    },
]

// Generate data sets for each signal.
Promise.all(
    signals.map((signal) =>
        createProgressiveFunctionGenerator()
            .setStart(0)
            .setEnd(signal.length)
            .setStep(1)
            .setSamplingFunction(signal.func)
            .generate()
            .toPromise()
            .then((data) => data.map((xy) => xy.y)),
    ),
).then((randomData) => {
    // Stream data into series.
    let tStart = window.performance.now()
    let pushedDataCount = 0
    const streamData = () => {
        const tNow = window.performance.now()
        // NOTE: This code is for example purposes (streaming stable data rate without destroying browser when switching tabs etc.)
        // In real use cases, data should be pushed in when it comes.
        const shouldBeDataPointsCount = Math.floor((dataPointsPerSecond * (tNow - tStart)) / 1000)
        const newDataPointsCount = Math.min(shouldBeDataPointsCount - pushedDataCount, 1000) // Add max 1000 data points per frame into a series. This prevents massive performance spikes when switching tabs for long times
        const newSamples = Object.fromEntries(Array.from({ length: SIGNALS.length }, (_, i) => [`y${i}`, []]))
        for (let iChannel = 0; iChannel < channels.length; iChannel++) {
            const randomDataCh = randomData[iChannel % randomData.length]
            const arr = newSamples[`y${iChannel}`]
            for (let iDp = 0; iDp < newDataPointsCount; iDp++) {
                const iData = (pushedDataCount + iDp) % randomDataCh.length
                const y = randomDataCh[iData]
                arr.push(y)
            }
        }
        dataSet.appendSamples(newSamples)
        pushedDataCount += newDataPointsCount
        requestAnimationFrame(streamData)
    }
    streamData()
})

// Measure FPS.
let tFpsStart = window.performance.now()
let frames = 0
let fps = 0
const title = chart.getTitle()
const recordFrame = () => {
    frames++
    const tNow = window.performance.now()
    fps = 1000 / ((tNow - tFpsStart) / frames)
    requestAnimationFrame(recordFrame)

    chart.setTitle(`${title} (FPS: ${fps.toFixed(1)})`)
}
requestAnimationFrame(recordFrame)
setInterval(() => {
    tFpsStart = window.performance.now()
    frames = 0
}, 5000)
