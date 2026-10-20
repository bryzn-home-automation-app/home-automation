package com.homeplatform.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Uses the running JVM's own `java` (single-file source launch) so it works on any OS. */
class ScriptRunnerTest {

    @TempDir
    Path dir;

    private List<String> java(String body) throws Exception {
        Path src = dir.resolve("Script.java");
        Files.writeString(src, "class Script { public static void main(String[] a) throws Exception { " + body + " } }");
        String javaBin = ProcessHandle.current().info().command().orElse("java");
        return List.of(javaBin, src.toString());
    }

    @Test
    @DisplayName("captures output and the exit code of a normal run")
    void normal() throws Exception {
        StringBuilder out = new StringBuilder();
        int code = ScriptRunner.run(java("System.out.println(\"synced 3 days\"); System.exit(2);"), out, Duration.ofSeconds(60));
        assertEquals(2, code);
        assertTrue(out.toString().contains("synced 3 days"));
    }

    @Test
    @DisplayName("a hung script is killed at the deadline instead of blocking forever")
    void hung() throws Exception {
        StringBuilder out = new StringBuilder();
        long start = System.nanoTime();
        int code = ScriptRunner.run(java("System.out.println(\"starting\"); Thread.sleep(600_000);"), out, Duration.ofSeconds(8));
        long seconds = Duration.ofNanos(System.nanoTime() - start).toSeconds();
        assertEquals(ScriptRunner.TIMED_OUT, code);
        assertTrue(seconds < 60, "returned after " + seconds + "s");
        assertTrue(out.toString().contains("killed"));
    }
}
