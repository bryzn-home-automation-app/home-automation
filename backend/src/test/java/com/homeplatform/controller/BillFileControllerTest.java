package com.homeplatform.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Bill PDFs are members-only and can't be used to read anything else on disk. */
class BillFileControllerTest {

    @TempDir
    Path uploads;
    private MockMvc mvc;

    @BeforeEach
    void setUp() throws Exception {
        Path bills = Files.createDirectories(uploads.resolve("bills"));
        Files.write(bills.resolve("9002001851_2026-09-08.pdf"), new byte[]{'%', 'P', 'D', 'F'});
        Files.writeString(uploads.resolve("secret.txt"), "nope");
        mvc = MockMvcBuilders.standaloneSetup(new BillFileController(bills)).build();
    }

    @Test
    @DisplayName("members get the PDF, uncached")
    void member() throws Exception {
        mvc.perform(get("/api/bills/file").param("path", "bills/9002001851_2026-09-08.pdf").requestAttr("role", "USER"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/pdf"))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")));
    }

    @Test
    @DisplayName("guests and anonymous callers are refused")
    void notMembers() throws Exception {
        mvc.perform(get("/api/bills/file").param("path", "bills/9002001851_2026-09-08.pdf").requestAttr("role", "GUEST"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/bills/file").param("path", "bills/9002001851_2026-09-08.pdf"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("anything but a bills/*.pdf name is a 404 — no path traversal")
    void traversal() throws Exception {
        for (String bad : new String[]{"bills/../secret.txt", "../secret.txt", "secret.txt", "bills/x.txt",
                "bills/sub/x.pdf", "bills/missing.pdf"}) {
            mvc.perform(get("/api/bills/file").param("path", bad).requestAttr("role", "ADMIN"))
                    .andExpect(status().isNotFound());
        }
    }
}
