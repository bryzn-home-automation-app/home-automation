package com.homeplatform.repository;

import com.homeplatform.model.RoombaPart;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoombaPartRepository extends JpaRepository<RoombaPart, Long> {
    List<RoombaPart> findAllByOrderByPartIdAsc();
}
