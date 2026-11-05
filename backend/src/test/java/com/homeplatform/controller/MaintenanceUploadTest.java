package com.homeplatform.controller;

import com.homeplatform.service.MaintenanceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The maintenance upload folder is served from the app's origin, so only photos go in. */
class MaintenanceUploadTest {

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new MaintenanceController(mock(MaintenanceService.class))).build();
    }

    @Test
    @DisplayName("an HTML or SVG file is refused, whatever its content type")
    void scriptableFilesRefused() throws Exception {
        for (String name : new String[]{"x.html", "x.svg", "x.htm", "photo", "x.jpg.html"}) {
            var file = new MockMultipartFile("file", name, "image/png", "<script>alert(1)</script>".getBytes());
            mvc.perform(multipart("/api/maintenance/upload").file(file)
                            .requestAttr("userId", 5L).requestAttr("role", "USER"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    @DisplayName("no signed-in member, or a guest → 403")
    void membersOnly() throws Exception {
        var file = new MockMultipartFile("file", "a.jpg", "image/jpeg", new byte[]{1, 2, 3});
        mvc.perform(multipart("/api/maintenance/upload").file(file))
                .andExpect(status().isForbidden());
        mvc.perform(multipart("/api/maintenance/upload").file(file)
                        .requestAttr("userId", 9L).requestAttr("role", "GUEST"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("photo extensions are accepted case-insensitively")
    void photoExtensions() {
        assertEquals(".jpg", MaintenanceController.photoExtension("IMG_0001.JPG"));
        assertEquals(".heic", MaintenanceController.photoExtension("IMG_0002.heic"));
        assertNull(MaintenanceController.photoExtension("notes.pdf"));
        assertNull(MaintenanceController.photoExtension(null));
    }
}
