package com.homeplatform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class HomePlatformApplication {

    public static void main(String[] args) {
        SpringApplication.run(HomePlatformApplication.class, args);
    }
}
