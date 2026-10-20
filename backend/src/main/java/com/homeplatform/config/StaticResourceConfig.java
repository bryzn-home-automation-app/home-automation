package com.homeplatform.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;

@Configuration
public class StaticResourceConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Serve uploaded files from the uploads directory (absolute path to avoid Tomcat temp dir).
        // Only folders that are safe without a login: avatars and maintenance photos have
        // random names. Bill PDFs (uploads/bills — guessable names, personal details) are
        // NOT served here; BillFileController serves them to members only.
        Path uploads = Path.of(System.getProperty("user.dir", "."), "uploads");
        registry.addResourceHandler("/uploads/avatars/**").addResourceLocations(dir(uploads.resolve("avatars")));
        registry.addResourceHandler("/uploads/maintenance/**").addResourceLocations(dir(uploads.resolve("maintenance")));
    }

    /** A folder location must end in "/" — toUri() only adds it when the folder already exists. */
    private static String dir(Path p) {
        String uri = p.toUri().toString();
        return uri.endsWith("/") ? uri : uri + "/";
    }
}
