package com.imran.recorder

import com.imran.recorder.data.AudioSource
import com.imran.recorder.data.Orientation
import com.imran.recorder.data.SortMode
import com.imran.recorder.util.Format
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatTest {

    @Test
    fun `clock switches to hours only past an hour`() {
        assertEquals("00:00", Format.clock(0))
        assertEquals("00:09", Format.clock(9_400))
        assertEquals("01:05", Format.clock(65_000))
        assertEquals("59:59", Format.clock(3_599_000))
        assertEquals("1:00:00", Format.clock(3_600_000))
        assertEquals("2:03:04", Format.clock(7_384_000))
    }

    @Test
    fun `clock treats a negative elapsed time as zero`() {
        assertEquals("00:00", Format.clock(-5_000))
    }

    @Test
    fun `size scales through the units`() {
        assertEquals("0 B", Format.size(0))
        assertEquals("512 B", Format.size(512))
        assertEquals("1.0 KB", Format.size(1024))
        assertEquals("1.5 MB", Format.size(1024L * 1024 * 3 / 2))
        assertEquals("2.0 GB", Format.size(1024L * 1024 * 1024 * 2))
    }

    @Test
    fun `audio source flags match what each mode needs`() {
        assertFalse(AudioSource.MUTE.needsMic)
        assertFalse(AudioSource.MUTE.needsProjectionAudio)
        assertTrue(AudioSource.MIC.needsMic)
        assertFalse(AudioSource.MIC.needsProjectionAudio)
        assertFalse(AudioSource.INTERNAL.needsMic)
        assertTrue(AudioSource.INTERNAL.needsProjectionAudio)
        assertTrue(AudioSource.INTERNAL_MIC.needsMic)
        assertTrue(AudioSource.INTERNAL_MIC.needsProjectionAudio)
    }

    @Test
    fun `enum lookups round-trip and fall back safely`() {
        for (mode in AudioSource.entries) assertEquals(mode, AudioSource.from(mode.key))
        for (mode in SortMode.entries) assertEquals(mode, SortMode.from(mode.key))
        for (mode in Orientation.entries) assertEquals(mode, Orientation.from(mode.key))

        assertEquals(AudioSource.MUTE, AudioSource.from("nonsense"))
        assertEquals(SortMode.NEWEST, SortMode.from(null))
        assertEquals(Orientation.AUTO, Orientation.from(""))
    }

    @Test
    fun `resolution labels read the way the settings row shows them`() {
        assertEquals("Native", Format.resolutionLabel(0))
        assertEquals("720p (HD)", Format.resolutionLabel(720))
        assertEquals("1080p (Full HD)", Format.resolutionLabel(1080))
    }
}
