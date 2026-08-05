package com.homeplatform.service;

import com.homeplatform.model.UtilityProvider;
import com.homeplatform.repository.UtilityProviderRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class UtilityProviderService {

    private final UtilityProviderRepository repository;

    public UtilityProviderService(UtilityProviderRepository repository) {
        this.repository = repository;
    }

    public List<UtilityProvider> getAll() {
        return repository.findAll();
    }

    public List<UtilityProvider> getActive() {
        return repository.findByIsActiveTrue();
    }

    public Optional<UtilityProvider> getById(Long id) {
        return repository.findById(id);
    }

    public List<UtilityProvider> getByType(String type) {
        return repository.findByType(type);
    }

    public UtilityProvider create(UtilityProvider provider) {
        return repository.save(provider);
    }
}
