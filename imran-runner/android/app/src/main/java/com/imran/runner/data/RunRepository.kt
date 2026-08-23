package com.imran.runner.data

import com.imran.runner.tracking.RoutePoint
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Local run history, stored as plain files under the app's private directory.
 *
 * The index holds one line per run and is appended to when a run finishes, so saving is O(1)
 * and a half-written line can only ever cost the run being saved. Route traces live in their
 * own file per run because they are long and only the history detail screen ever reads them.
 *
 * Takes a plain [File] root rather than a Context so the whole store can be exercised from JVM
 * unit tests against a temporary directory.
 */
class RunRepository(private val rootDir: File) {

    private val indexFile = File(rootDir, "runs.index")
    private val routesDir = File(rootDir, "routes")

    private val _runs = MutableStateFlow<List<RunRecord>>(emptyList())

    /** Newest run first. */
    val runs: StateFlow<List<RunRecord>> = _runs.asStateFlow()

    val stats: RunStats get() = RunStats.from(_runs.value)

    @Synchronized
    fun load() {
        if (!indexFile.exists()) {
            _runs.value = emptyList()
            return
        }
        val parsed = indexFile.readLines()
            .mapNotNull { if (it.isBlank()) null else RunCodec.decodeRun(it) }
            .sortedByDescending { it.startedAtEpochMs }
        _runs.value = parsed
    }

    @Synchronized
    fun save(run: RunRecord, route: List<RoutePoint>) {
        rootDir.mkdirs()
        if (route.isNotEmpty()) {
            routesDir.mkdirs()
            routeFile(run.id).writeText(
                route.joinToString(separator = "\n") { RunCodec.encodePoint(it) },
            )
        }
        indexFile.appendText(RunCodec.encodeRun(run) + "\n")
        _runs.value = (listOf(run) + _runs.value).sortedByDescending { it.startedAtEpochMs }
    }

    @Synchronized
    fun delete(id: Long) {
        val remaining = _runs.value.filterNot { it.id == id }
        if (remaining.size == _runs.value.size) return
        routeFile(id).delete()
        rewrite(remaining)
    }

    @Synchronized
    fun clearAll() {
        routesDir.deleteRecursively()
        indexFile.delete()
        _runs.value = emptyList()
    }

    fun route(id: Long): List<RoutePoint> {
        val file = routeFile(id)
        if (!file.exists()) return emptyList()
        return file.readLines().mapNotNull { if (it.isBlank()) null else RunCodec.decodePoint(it) }
    }

    private fun rewrite(records: List<RunRecord>) {
        rootDir.mkdirs()
        indexFile.writeText(
            records.joinToString(separator = "") { RunCodec.encodeRun(it) + "\n" },
        )
        _runs.value = records.sortedByDescending { it.startedAtEpochMs }
    }

    private fun routeFile(id: Long) = File(routesDir, "$id.route")
}
