package com.homeplatform.controller;

import com.homeplatform.model.UtilityProvider;
import com.homeplatform.service.UtilityProviderService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/utility-providers")
public class UtilityProviderController {

    private final UtilityProviderService service;

    public UtilityProviderController(UtilityProviderService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<UtilityProvider>> getAll() {
        return ResponseEntity.ok(service.getAll());
    }

    @GetMapping("/active")
    public ResponseEntity<List<UtilityProvider>> getActive() {
        return ResponseEntity.ok(service.getActive());
    }

    @GetMapping("/{id}")
    public ResponseEntity<UtilityProvider> getById(@PathVariable Long id) {
        return service.getById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/type/{type}")
    public ResponseEntity<List<UtilityProvider>> getByType(@PathVariable String type) {
        return ResponseEntity.ok(service.getByType(type));
    }
}
