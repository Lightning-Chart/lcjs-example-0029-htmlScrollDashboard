/**
 * Lightning-fast Line Chart visualization over multiple channels that progress on the same X Axis
 */

const lcjs = require('@arction/lcjs')
const xydata = require('@arction/xydata')

// NOTE: Assuming predefined number of stacked channels.
const SIGNALS = new Array(20).fill(0).map((_, i) => ({
    title: `Ch ${i + 1}`,
}))
const DEFAULT_X_RANGE_MS = 10 * 1000
const DASHBOARD_HEIGHT = 1400

const {
    lightningChart,
    AutoCursorModes,
    emptyLine,
    AxisTickStrategies,
    AxisScrollStrategies,
    synchronizeAxisIntervals,
    UIOrigins,
    UIDraggingModes,
    emptyFill,
    Themes,
} = lcjs

const { createProgressiveFunctionGenerator } = xydata

const exampleContainer = document.getElementById('chart') || document.body
const layout = document.createElement('div')
exampleContainer.append(layout)
layout.style.width = '100%'
layout.style.height = `${DASHBOARD_HEIGHT}px`
layout.style.display = 'flex'
layout.style.flexDirection = 'column'

const lc = lightningChart()

const channels = SIGNALS.map((signal, iSignal) => {
    const container = document.createElement('div')
    layout.append(container)
    container.style.height = '20vh'
    const chart = lc
        .ChartXY({
            container,
            // theme: Themes.darkGold
        })
        .setTitle('')
        .setPadding({
            top: 0,
            bottom: 0,
        })
        .setAutoCursorMode(AutoCursorModes.disabled)
        .setBackgroundStrokeStyle(emptyLine)
        .setMouseInteractions(false)

    const axisX = chart
        .getDefaultAxisX()
        .setTickStrategy(AxisTickStrategies.Empty)
        .setStrokeStyle(emptyLine)
        .setScrollStrategy(AxisScrollStrategies.progressive)
        .setDefaultInterval((state) => ({ end: state.dataMax, start: (state.dataMax ?? 0) - DEFAULT_X_RANGE_MS, stopAxisAfter: false }))
    const axisY = chart
        .getDefaultAxisY()
        .setTickStrategy(AxisTickStrategies.Empty)
        .setStrokeStyle(emptyLine)
        .setTitle(signal.title)
        .setTitleRotation(0)
        .setThickness(60)

    const series = chart
        .addPointLineAreaSeries({
            dataPattern: 'ProgressiveX',
            automaticColorIndex: iSignal,
        })
        .setName(`Channel ${iSignal + 1}`)
        .setMaxSampleCount(20_000)
        .setAreaFillStyle(emptyFill)
        // Use -1 thickness for best performance, especially on low end devices like mobile / laptops.
        .setStrokeStyle((style) => style.setThickness(-1))

    return { chart, series, axisX, axisY }
})
const channelTop = channels[0]
const channelBottom = channels[channels.length - 1]

channelTop.chart.setTitle(`Multi-channel real-time monitoring (${SIGNALS.length} chs, 1000 Hz)`)

const axisX = channelBottom.axisX.setTickStrategy(AxisTickStrategies.Time, (ticks) =>
    ticks
        .setMajorTickStyle((major) => major.setGridStrokeStyle(emptyLine))
        .setMinorTickStyle((minor) => minor.setGridStrokeStyle(emptyLine)),
)
synchronizeAxisIntervals(...channels.map((ch) => ch.axisX))

// Custom interactions for zooming in/out along Time axis while keeping data scrolling.
axisX.setNibInteractionScaleByDragging(false).setNibInteractionScaleByWheeling(false).setAxisInteractionZoomByWheeling(false)
const customZoomX = (_, event) => {
    const interval = axisX.getInterval()
    const range = interval.end - interval.start
    const newRange = range + Math.sign(event.deltaY) * 0.1 * Math.abs(range)
    axisX.setInterval({ start: interval.end - newRange, end: interval.end, stopAxisAfter: false })
    event.preventDefault()
    event.stopPropagation()
}
axisX.onAxisInteractionAreaMouseWheel(customZoomX)
channels.forEach((channel) => {
    channel.chart.onSeriesBackgroundMouseWheel(customZoomX)
    channel.series.onMouseWheel(customZoomX)
})

// Add LCJS user interface button for resetting view.
const buttonReset = channels[channels.length - 1].chart
    .addUIElement()
    .setText('Reset')
    .setPosition({ x: 0, y: 0 })
    .setOrigin(UIOrigins.LeftBottom)
    .setMargin({ left: 4, bottom: 4 })
    .setDraggingMode(UIDraggingModes.notDraggable)
buttonReset.onMouseClick((_) => {
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
).then((dataSets) => {
    // Stream data into series.
    let tStart = window.performance.now()
    let pushedDataCount = 0
    const dataPointsPerSecond = 1000 // 1000 Hz
    const xStep = 1000 / dataPointsPerSecond
    const streamData = () => {
        const tNow = window.performance.now()
        // NOTE: This code is for example purposes (streaming stable data rate without destroying browser when switching tabs etc.)
        // In real use cases, data should be pushed in when it comes.
        const shouldBeDataPointsCount = Math.floor((dataPointsPerSecond * (tNow - tStart)) / 1000)
        const newDataPointsCount = Math.min(shouldBeDataPointsCount - pushedDataCount, 1000) // Add max 1000 data points per frame into a series. This prevents massive performance spikes when switching tabs for long times
        const seriesNewDataPoints = []
        for (let iChannel = 0; iChannel < channels.length; iChannel++) {
            const dataSet = dataSets[iChannel % dataSets.length]
            const newDataPoints = []
            for (let iDp = 0; iDp < newDataPointsCount; iDp++) {
                const x = (pushedDataCount + iDp) * xStep
                const iData = (pushedDataCount + iDp) % dataSet.length
                const y = dataSet[iData]
                const point = { x, y }
                newDataPoints.push(point)
            }
            seriesNewDataPoints[iChannel] = newDataPoints
        }
        channels.forEach((channel, iChannel) => channel.series.appendJSON(seriesNewDataPoints[iChannel]))
        pushedDataCount += newDataPointsCount
        requestAnimationFrame(streamData)
    }
    streamData()
})

// Measure FPS.
let tFpsStart = window.performance.now()
let frames = 0
let fps = 0
const title = channelTop.chart.getTitle()
const recordFrame = () => {
    frames++
    const tNow = window.performance.now()
    fps = 1000 / ((tNow - tFpsStart) / frames)
    requestAnimationFrame(recordFrame)

    channelTop.chart.setTitle(`${title} (FPS: ${fps.toFixed(1)})`)
}
requestAnimationFrame(recordFrame)
setInterval(() => {
    tFpsStart = window.performance.now()
    frames = 0
}, 5000)
