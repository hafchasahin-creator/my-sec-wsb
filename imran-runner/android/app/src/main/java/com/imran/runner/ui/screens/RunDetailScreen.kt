package com.imran.runner.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.imran.runner.core.Format
import com.imran.runner.data.RunRecord
import com.imran.runner.tracking.RoutePoint
import com.imran.runner.ui.components.ImranIcon
import com.imran.runner.ui.components.RouteTrace
import com.imran.runner.ui.components.RunnerIcon
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType

@Composable
fun RunDetailScreen(
    run: RunRecord,
    route: List<RoutePoint>,
    onBack: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(50))
                    .background(ImranColors.Surface)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Text("‹", style = ImranType.StatValue.copy(color = ImranColors.TextPrimary))
            }
            Spacer(Modifier.size(14.dp))
            Text(formatRunDate(run.startedAtEpochMs), style = ImranType.Title)
        }

        Spacer(Modifier.height(20.dp))

        if (route.size > 1) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(1.25f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(ImranColors.Surface)
                    .padding(18.dp),
            ) {
                RouteTrace(
                    points = route,
                    color = ImranColors.Accent,
                    modifier = Modifier.fillMaxSize(),
                    strokeWidth = 4.dp,
                    showEnds = true,
                )
            }
            Spacer(Modifier.height(18.dp))
        }

        DetailGrid(
            listOf(
                Triple("DISTANCE", Format.distanceKm(run.distanceMeters), "KM" to ImranColors.Blue),
                Triple("DURATION", Format.duration(run.durationMs), "TIME" to ImranColors.Accent),
                Triple("CALORIES", Format.integer(run.calories), "KCAL" to ImranColors.Orange),
                Triple("AVG PACE", Format.pace(run.avgPaceSecPerKm), "/KM" to ImranColors.Blue),
                Triple(
                    "AVG SPEED",
                    Format.oneDecimal(run.avgSpeedMps * 3.6),
                    "KM/H" to ImranColors.Blue,
                ),
                Triple(
                    "MAX SPEED",
                    Format.oneDecimal(run.maxSpeedMps * 3.6),
                    "KM/H" to ImranColors.Blue,
                ),
                Triple(
                    "ELEVATION",
                    Format.integer(run.elevationGainMeters),
                    "M GAIN" to ImranColors.Orange,
                ),
                Triple("GPS POINTS", run.routePointCount.toString(), "FIXES" to ImranColors.TextDim),
            ),
        )

        Spacer(Modifier.height(22.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(ImranColors.Surface)
                .clickable(onClick = onDelete)
                .padding(vertical = 15.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ImranIcon(RunnerIcon.Flag, ImranColors.Red, size = 18.dp)
            Spacer(Modifier.size(10.dp))
            Text("DELETE THIS RUN", style = ImranType.ControlLabel.copy(color = ImranColors.Red))
        }

        Spacer(Modifier.height(30.dp))
    }
}

@Composable
private fun DetailGrid(cells: List<Triple<String, String, Pair<String, Color>>>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        cells.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { (label, value, unit) ->
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(18.dp))
                            .background(ImranColors.Surface)
                            .padding(vertical = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(label, style = ImranType.Label)
                        Spacer(Modifier.height(7.dp))
                        Text(value, style = ImranType.PanelValue, maxLines = 1, softWrap = false)
                        Spacer(Modifier.height(3.dp))
                        Text(unit.first, style = ImranType.Unit.copy(color = unit.second))
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}
