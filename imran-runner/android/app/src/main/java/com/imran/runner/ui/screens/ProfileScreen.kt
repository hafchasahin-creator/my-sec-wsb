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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imran.runner.core.Calories
import com.imran.runner.core.Format
import com.imran.runner.data.Profile
import com.imran.runner.ui.components.ImranIcon
import com.imran.runner.ui.components.RunnerIcon
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType
import java.util.Locale
import kotlin.math.roundToInt

/** Energy per kilometre at an easy 10 km/h, so the weight setting shows what it actually changes. */
private fun kcalPerKm(weightKg: Double): Double {
    val speedMps = 10.0 / 3.6
    val minutesPerKm = 1_000.0 / speedMps / 60.0
    return Calories.kcalPerMinute(speedMps, weightKg) * minutesPerKm
}

@Composable
fun ProfileScreen(
    profile: Profile,
    totalRuns: Int,
    versionName: String,
    onProfileChange: ((Profile) -> Profile) -> Unit,
    onClearHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var confirmClear by remember { mutableStateOf(false) }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        ScreenHeading("PROFILE", "Used to work out how hard you are working")

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(62.dp)
                    .clip(RoundedCornerShape(50))
                    .background(ImranColors.SurfaceRaised),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    profile.name.trim().ifEmpty { Profile.DEFAULT_NAME }.take(1).uppercase(Locale.US),
                    style = ImranType.StatValue.copy(color = ImranColors.Accent),
                )
            }
            Spacer(Modifier.size(16.dp))
            Column(Modifier.weight(1f)) {
                Text("NAME", style = ImranType.Label)
                Spacer(Modifier.height(6.dp))
                BasicTextField(
                    value = profile.name,
                    onValueChange = { next -> onProfileChange { it.copy(name = next) } },
                    singleLine = true,
                    textStyle = ImranType.BodyStrong.copy(fontSize = 19.sp),
                    cursorBrush = SolidColor(ImranColors.Accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(4.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(ImranColors.Divider))
            }
        }

        Spacer(Modifier.height(26.dp))

        // Weight is the one number here that changes the maths, so it gets the most room.
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(22.dp))
                .background(ImranColors.Surface)
                .padding(18.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("WEIGHT", style = ImranType.Label, modifier = Modifier.weight(1f))
                Stepper("−") { onProfileChange { it.copy(weightKg = it.weightKg - 0.5) } }
                Spacer(Modifier.size(10.dp))
                Stepper("+") { onProfileChange { it.copy(weightKg = it.weightKg + 0.5) } }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    String.format(Locale.US, "%.1f", profile.weightKg),
                    style = ImranType.Hero.copy(fontSize = 46.sp, letterSpacing = (-1.5).sp),
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    "KG",
                    style = ImranType.HeroUnit.copy(fontSize = 16.sp, letterSpacing = 3.sp),
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            Slider(
                value = profile.weightKg.toFloat(),
                onValueChange = { next ->
                    onProfileChange { it.copy(weightKg = (next * 2f).roundToInt() / 2.0) }
                },
                valueRange = Profile.MIN_WEIGHT_KG.toFloat()..Profile.MAX_WEIGHT_KG.toFloat(),
                colors = SliderDefaults.colors(
                    thumbColor = ImranColors.Accent,
                    activeTrackColor = ImranColors.Accent,
                    inactiveTrackColor = ImranColors.Track,
                ),
            )
            Text(
                "About ${Format.integer(kcalPerKm(profile.weightKg))} kcal per kilometre at an easy pace.",
                style = ImranType.Body,
            )
        }

        Spacer(Modifier.height(22.dp))

        SettingToggle(
            icon = RunnerIcon.Speedometer,
            title = "Auto-pause",
            body = "Stop the clock when you stop moving, and start it again when you set off.",
            checked = profile.autoPause,
            onChange = { next -> onProfileChange { it.copy(autoPause = next) } },
        )
        Spacer(Modifier.height(12.dp))
        SettingToggle(
            icon = RunnerIcon.Stopwatch,
            title = "Keep the screen on",
            body = "Leave the display awake while a run is recording.",
            checked = profile.keepScreenOn,
            onChange = { next -> onProfileChange { it.copy(keepScreenOn = next) } },
        )

        Spacer(Modifier.height(26.dp))

        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(ImranColors.Surface)
                .padding(18.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ImranIcon(RunnerIcon.Runner, ImranColors.Accent, size = 22.dp)
                Spacer(Modifier.size(12.dp))
                Column {
                    Text("IMRAN RUNNER", style = ImranType.Title.copy(fontSize = 14.sp))
                    Spacer(Modifier.height(3.dp))
                    Text("Version $versionName", style = ImranType.Body)
                }
            }
            Spacer(Modifier.height(14.dp))
            Text(
                "Runs are recorded from your phone's own GPS and stored only on this device. " +
                    "Nothing is uploaded anywhere.",
                style = ImranType.Body,
            )
        }

        Spacer(Modifier.height(14.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(ImranColors.Surface)
                .clickable(enabled = totalRuns > 0) { confirmClear = true }
                .padding(vertical = 15.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            Text(
                if (totalRuns > 0) "DELETE ALL $totalRuns RUNS" else "NO RUNS TO DELETE",
                style = ImranType.ControlLabel.copy(
                    color = if (totalRuns > 0) ImranColors.Red else ImranColors.TextFaint,
                ),
            )
        }

        Spacer(Modifier.height(34.dp))
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            containerColor = ImranColors.SurfaceRaised,
            title = { Text("Delete every run?", style = ImranType.BodyStrong) },
            text = {
                Text(
                    "All $totalRuns runs and their routes will be removed from this phone. " +
                        "This cannot be undone.",
                    style = ImranType.Body,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onClearHistory()
                    confirmClear = false
                }) {
                    Text("DELETE", style = ImranType.ControlLabel.copy(color = ImranColors.Red))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmClear = false }) {
                    Text("CANCEL", style = ImranType.ControlLabel.copy(color = ImranColors.TextMuted))
                }
            },
        )
    }
}

@Composable
private fun Stepper(symbol: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(RoundedCornerShape(50))
            .background(ImranColors.SurfaceRaised)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(symbol, style = ImranType.BodyStrong.copy(fontSize = 20.sp))
    }
}

@Composable
private fun SettingToggle(
    icon: RunnerIcon,
    title: String,
    body: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(ImranColors.Surface)
            .clickable { onChange(!checked) }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ImranIcon(icon, if (checked) ImranColors.Accent else ImranColors.TextDim, size = 20.dp)
        Spacer(Modifier.size(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = ImranType.BodyStrong)
            Spacer(Modifier.height(3.dp))
            Text(body, style = ImranType.Body.copy(fontSize = 12.sp))
        }
        Spacer(Modifier.size(10.dp))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = ImranColors.AccentDeep,
                uncheckedThumbColor = ImranColors.TextDim,
                uncheckedTrackColor = ImranColors.SurfaceRaised,
                uncheckedBorderColor = ImranColors.Divider,
            ),
        )
    }
}
