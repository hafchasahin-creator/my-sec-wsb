package com.imran.runner.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imran.runner.core.Format
import com.imran.runner.data.RunRecord
import com.imran.runner.tracking.RoutePoint
import com.imran.runner.ui.components.ImranIcon
import com.imran.runner.ui.components.RouteTrace
import com.imran.runner.ui.components.RunnerIcon
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val DATE_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("EEE d MMM · HH:mm", Locale.US)

internal fun formatRunDate(epochMs: Long): String =
    Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()).format(DATE_FORMAT).uppercase(Locale.US)

@Composable
fun HistoryScreen(
    runs: List<RunRecord>,
    routeFor: (Long) -> List<RoutePoint>,
    onOpen: (RunRecord) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        ScreenHeading("HISTORY", "${runs.size} " + if (runs.size == 1) "run recorded" else "runs recorded")

        if (runs.isEmpty()) {
            EmptyState(
                icon = RunnerIcon.History,
                title = "No runs yet",
                body = "Your finished runs are saved here, with the route you took and every number from the session.",
            )
            return@Column
        }

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
        ) {
            items(runs, key = { it.id }) { run ->
                HistoryCard(run = run, routeFor = routeFor, onClick = { onOpen(run) })
            }
        }
    }
}

@Composable
private fun HistoryCard(
    run: RunRecord,
    routeFor: (Long) -> List<RoutePoint>,
    onClick: () -> Unit,
) {
    // Routes are read off disk, so only the cards actually scrolled into view pay for one.
    val route by produceState<List<RoutePoint>>(initialValue = emptyList(), run.id) {
        value = withContext(Dispatchers.IO) { routeFor(run.id) }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(ImranColors.Surface)
            .clickable(onClick = onClick)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(formatRunDate(run.startedAtEpochMs), style = ImranType.Label)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(Format.distanceKm(run.distanceMeters), style = ImranType.StatValue)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "KM",
                        style = ImranType.Unit.copy(color = ImranColors.Blue),
                        modifier = Modifier.padding(bottom = 5.dp),
                    )
                }
            }
            if (route.size > 1) {
                RouteTrace(
                    points = route,
                    color = ImranColors.Accent,
                    modifier = Modifier.size(width = 92.dp, height = 56.dp),
                    strokeWidth = 2.5.dp,
                )
            }
        }

        Spacer(Modifier.height(14.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(ImranColors.Divider))
        Spacer(Modifier.height(12.dp))

        Row(Modifier.fillMaxWidth()) {
            MiniStat("TIME", Format.duration(run.durationMs), ImranColors.Accent, Modifier.weight(1f))
            MiniStat("/KM", Format.pace(run.avgPaceSecPerKm), ImranColors.Blue, Modifier.weight(1f))
            MiniStat("KCAL", Format.integer(run.calories), ImranColors.Orange, Modifier.weight(1f))
            MiniStat(
                "KM/H",
                Format.oneDecimal(run.avgSpeedMps * 3.6),
                ImranColors.Blue,
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun MiniStat(unit: String, value: String, tint: Color, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = ImranType.BodyStrong, maxLines = 1, softWrap = false)
        Spacer(Modifier.height(3.dp))
        Text(unit, style = ImranType.Unit.copy(color = tint, fontSize = 10.sp))
    }
}

/** Section heading shared by History, Stats and Profile. */
@Composable
internal fun ScreenHeading(title: String, subtitle: String) {
    Spacer(Modifier.height(14.dp))
    Text(title, style = ImranType.Title)
    Spacer(Modifier.height(5.dp))
    Text(subtitle, style = ImranType.Body)
    Spacer(Modifier.height(18.dp))
}

@Composable
internal fun EmptyState(icon: RunnerIcon, title: String, body: String) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(76.dp)
                .clip(RoundedCornerShape(50))
                .background(ImranColors.Surface),
            contentAlignment = Alignment.Center,
        ) {
            ImranIcon(icon, ImranColors.TextFaint, size = 34.dp)
        }
        Spacer(Modifier.height(18.dp))
        Text(title, style = ImranType.BodyStrong)
        Spacer(Modifier.height(8.dp))
        Text(
            body,
            style = ImranType.Body,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        Spacer(Modifier.height(60.dp))
    }
}
