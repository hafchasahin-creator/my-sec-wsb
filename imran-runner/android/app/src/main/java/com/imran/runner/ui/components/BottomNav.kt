package com.imran.runner.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType

enum class NavTab(val label: String, val icon: RunnerIcon) {
    Run("Run", RunnerIcon.Runner),
    History("History", RunnerIcon.History),
    Stats("Stats", RunnerIcon.Stats),
    Profile("Profile", RunnerIcon.Person),
}

@Composable
fun BottomNav(
    selected: NavTab,
    onSelect: (NavTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(ImranColors.Surface)
            .padding(top = 11.dp, bottom = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NavTab.entries.forEach { tab ->
            val active = tab == selected
            val tint by animateColorAsState(
                targetValue = if (active) ImranColors.Accent else ImranColors.TextDim,
                animationSpec = tween(220),
                label = "navTint",
            )
            val underline by animateDpAsState(
                targetValue = if (active) 18.dp else 0.dp,
                animationSpec = tween(240),
                label = "navUnderline",
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onSelect(tab) },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ImranIcon(tab.icon, tint, size = 23.dp)
                Spacer(Modifier.height(4.dp))
                Text(tab.label, style = ImranType.NavLabel.copy(color = tint))
                Spacer(Modifier.height(5.dp))
                Box(
                    Modifier
                        .width(underline)
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (active) ImranColors.Accent else ImranColors.Surface),
                )
            }
        }
    }
}
