package com.solanamobile.seekerconnect.compose

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser

/**
 * Draws design-file path data, scaling [viewBox] (in the paths' coordinate
 * space) to the composable's size. Filled when [strokeWidth] is null.
 */
@Composable
internal fun BrandVector(
    paths: List<String>,
    viewBox: Rect,
    color: Color,
    modifier: Modifier = Modifier,
    strokeWidth: Float? = null,
) {
    val parsed = remember(paths) { paths.map { PathParser().parsePathString(it).toPath() } }
    val style = strokeWidth?.let(::Stroke) ?: Fill
    Canvas(modifier) {
        scale(size.width / viewBox.width, size.height / viewBox.height, pivot = Offset.Zero) {
            translate(-viewBox.left, -viewBox.top) {
                parsed.forEach { drawPath(it, color, style = style) }
            }
        }
    }
}
