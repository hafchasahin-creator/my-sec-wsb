package com.imran.runner.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imran.runner.core.Format
import com.imran.runner.data.RunRecord
import com.imran.runner.data.RunStats
import com.imran.runner.ui.components.ImranIcon
import com.imran.runner.ui.components.RunnerIcon
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

private const val WEEKS_SHOWN = 8

internal data class WeekBar(val label: String, val distanceMeters: Double)

/** Distance per week for the last [WEEKS_SHOWN] weeks, oldest first. */
internal fun weeklyDistances(runs: List<RunRecord>, today: LocalDate, zone: ZoneId): List<WeekBar> {
    val thisMonday = today.with(DayOfWeek.MONDAY)
    return (0 until WEEKS_SHOWN).map { index ->
        val start = thisMonday.minusWeeks((WEEKS_SHOWN - 1 - index).toLong())
        val end = start.plusWeeks(1)
        val total = runs.sumOf { run ->
            val day = Instant.ofEpochMilli(run.startedAtEpochMs).atZone(zone).toLocalDate()
            if (!day.isBefore(start) && day.isBefore(end)) run.distanceMeters else 0.0
        }
        WeekBar(label = start.dayOfMonth.toString(), distanceMeters = total)
    }
}

@Composable
fun StatsScreen(
    runs: List<RunRecord>,
    stats: RunStats,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        ScreenHeading("STATS", "Everything you have run with Imran Runner")

        if (runs.isEmpty()) {
            EmptyState(
                icon = RunnerIcon.Stats,
                title = "Nothing to total yet",
                body = "Finish your first run and your lifetime distance, calories, time and personal records will build up here.",
            )
            return@Column
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TotalTile(
                "TOTAL DISTANCE",
                Format.distanceKm(stats.totalDistanceMeters),
                "KM",
                ImranColors.Blue,
                RunnerIcon.Road,
                Modifier.weight(1f),
            )
            TotalTile(
                "TOTAL CALORIES",
                Format.integer(stats.totalCalories),
                "KCAL",
                ImranColors.Orange,
                RunnerIcon.Flame,
                Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TotalTile(
                "TOTAL TIME",
                Format.duration(stats.totalDurationMs),
                "TIME",
                ImranColors.Accent,
                RunnerIcon.Stopwatch,
                Modifier.weight(1f),
            )
            TotalTile(
                "TOTAL RUNS",
                stats.totalRuns.toString(),
                "SESSIONS",
                ImranColors.Accent,
                RunnerIcon.Runner,
                Modifier.weight(1f),
            )
        }

        Spacer(Modifier.height(26.dp))
        Text("LAST 8 WEEKS", style = ImranType.Label)
        Spacer(Modifier.height(14.dp))
        WeeklyChart(weeklyDistances(runs, LocalDate.now(), ZoneId.systemDefault()))

        Spacer(Modifier.height(26.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            ImranIcon(RunnerIcon.Trophy, ImranColors.Amber, size = 18.dp)
            Spacer(Modifier.size(9.dp))
            Text("PERSONAL RECORDS", style = ImranType.Label.copy(color = ImranColors.Amber))
        }
        Spacer(Modifier.height(14.dp))

        RecordRow("Longest run", Format.distanceKm(stats.longestDistanceMeters) + " km")
        RecordRow("Longest time", Format.duration(stats.longestDurationMs))
        RecordRow("Best average pace", Format.pace(stats.bestPaceSecPerKm) + " /km")
        RecordRow(
            "Fastest average speed",
            Format.oneDecimal(stats.fastestAvgSpeedMps * 3.6) + " km/h",
        )
        RecordRow("Top speed", Format.oneDecimal(stats.topSpeedMps * 3.6) + " km/h")

        Spacer(Modifier.height(34.dp))
    }
}

@Composable
private fun TotalTile(
    label: String,
    value: String,
    unit: String,
    tint: Color,
    icon: RunnerIcon,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(ImranColors.Surface)
            .padding(16.dp),
    ) {
        ImranIcon(icon, tint, size = 22.dp)
        Spacer(Modifier.height(12.dp))
        Text(label, style = ImranType.Label.copy(fontSize = 11.sp))
        Spacer(Modifier.height(6.dp))
        Text(value, style = ImranType.PanelValue, maxLines = 1, softWrap = false)
        Spacer(Modifier.height(3.dp))
        Text(unit, style = ImranType.Unit.copy(color = tint))
    }
}

@Composable
private fun RecordRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = ImranType.Body)
        Text(value, style = ImranType.BodyStrong)
    }
}

@Composable
private fun WeeklyChart(weeks: List<WeekBar>) {
    val peak = weeks.maxOfOrNull { it.distanceMeters }?.coerceAtLeast(1.0) ?: 1.0
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(ImranColors.Surface)
            .padding(16.dp),
    ) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(120.dp),
        ) {
            val gap = size.width * 0.035f
            val barWidth = (size.width - gap * (weeks.size - 1)) / weeks.size
            weeks.forEachIndexed { index, week ->
                val fraction = (week.distanceMeters / peak).toFloat().coerceIn(0f, 1f)
                val barHeight = (size.height * fraction).coerceAtLeast(if (fraction > 0f) 4f else 2f)
                val x = index * (barWidth + gap)
                drawRoundRect(
                    color = if (week.distanceMeters > 0.0) {
                        if (index == weeks.lastIndex) ImranColors.Accent else ImranColors.AccentDeep
                    } else {
                        ImranColors.Track
                    },
                    topLeft = Offset(x, size.height - barHeight),
                    size = Size(barWidth, barHeight),
                    cornerRadius = CornerRadius(barWidth * 0.28f, barWidth * 0.28f),
                    alpha = if (week.distanceMeters > 0.0) 1f else 0.6f,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            weeks.forEach {
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Text(it.label, style = ImranType.Unit.copy(color = ImranColors.TextFaint))
                }
            }
        }
    }
}
