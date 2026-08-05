package com.homeplatform.repository;

import com.homeplatform.model.UtilityProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UtilityProviderRepository extends JpaRepository<UtilityProvider, Long> {

    List<UtilityProvider> findByIsActiveTrue();

    Optional<UtilityProvider> findByName(String name);

    List<UtilityProvider> findByType(String type);
}
