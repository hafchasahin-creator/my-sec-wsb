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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imran.runner.core.Format
import com.imran.runner.data.RunRecord
import com.imran.runner.ui.components.ImranIcon
import com.imran.runner.ui.components.RunnerIcon
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType

/** Shown the moment a run is saved, so the effort is acknowledged before the screen resets. */
@Composable
fun RunSummaryOverlay(
    run: RunRecord,
    onDone: () -> Unit,
    onViewHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ImranColors.Background.copy(alpha = 0.94f))
            // An empty pointerInput block consumes nothing, so this needs a real detector:
            // without it a tap would fall straight through to the controls behind the summary.
            .pointerInput(Unit) { detectTapGestures { } },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = 24.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(26.dp))
                .background(ImranColors.Surface)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ImranIcon(RunnerIcon.Trophy, ImranColors.Accent, size = 34.dp)
            Spacer(Modifier.height(14.dp))
            Text("RUN SAVED", style = ImranType.Title)
            Spacer(Modifier.height(6.dp))
            Text(formatRunDate(run.startedAtEpochMs), style = ImranType.Body)

            Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    Format.distanceKm(run.distanceMeters),
                    style = ImranType.Hero.copy(fontSize = 58.sp, letterSpacing = (-2).sp),
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    "KM",
                    style = ImranType.HeroUnit.copy(fontSize = 18.sp, letterSpacing = 3.sp),
                    modifier = Modifier.padding(bottom = 10.dp),
                )
            }

            Spacer(Modifier.height(20.dp))
            Row(Modifier.fillMaxWidth()) {
                SummaryCell("TIME", Format.duration(run.durationMs), ImranColors.Accent, Modifier.weight(1f))
                SummaryCell("PACE", Format.pace(run.avgPaceSecPerKm), ImranColors.Blue, Modifier.weight(1f))
                SummaryCell("KCAL", Format.integer(run.calories), ImranColors.Orange, Modifier.weight(1f))
            }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth()) {
                SummaryCell(
                    "AVG",
                    Format.oneDecimal(run.avgSpeedMps * 3.6),
                    ImranColors.Blue,
                    Modifier.weight(1f),
                )
                SummaryCell(
                    "MAX",
                    Format.oneDecimal(run.maxSpeedMps * 3.6),
                    ImranColors.Blue,
                    Modifier.weight(1f),
                )
                SummaryCell(
                    "CLIMB",
                    Format.integer(run.elevationGainMeters),
                    ImranColors.Orange,
                    Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(26.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(ImranColors.AccentDeep)
                    .clickable(onClick = onDone)
                    .padding(vertical = 15.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("DONE", style = ImranType.ControlLabel.copy(color = Color.White))
            }
            Spacer(Modifier.height(10.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .clickable(onClick = onViewHistory)
                    .padding(vertical = 13.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "VIEW IN HISTORY",
                    style = ImranType.ControlLabel.copy(color = ImranColors.TextMuted),
                )
            }
        }
    }
}

@Composable
private fun SummaryCell(label: String, value: String, tint: Color, modifier: Modifier = Modifier) {
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(value, style = ImranType.BodyStrong.copy(fontSize = 17.sp), maxLines = 1, softWrap = false)
        Spacer(Modifier.height(4.dp))
        Text(label, style = ImranType.Unit.copy(color = tint, fontSize = 10.sp))
    }
}
