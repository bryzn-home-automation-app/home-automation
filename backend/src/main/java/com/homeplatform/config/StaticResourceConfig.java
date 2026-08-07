package com.homeplatform.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;

@Configuration
public class StaticResourceConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Serve uploaded files from the uploads directory (absolute path to avoid Tomcat temp dir)
        String uploadPath = Path.of(System.getProperty("user.dir", "."), "uploads").toUri().toString();
        registry.addResourceHandler("/uploads/**")
                .addResourceLocations(uploadPath);
    }
}
