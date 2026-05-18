CREATE TABLE IF NOT EXISTS detections (
  id_detection SERIAL PRIMARY KEY,
  date_detection TIMESTAMP DEFAULT NOW(),
  image_path VARCHAR(255),
  gps_lat FLOAT,
  gps_lon FLOAT,
  clip_labels JSONB,
  malade BOOLEAN
);

CREATE TABLE IF NOT EXISTS alertes (
  id_alerte SERIAL PRIMARY KEY,
  type_alerte VARCHAR(50),
  date_alerte TIMESTAMP DEFAULT NOW(),
  statut VARCHAR(50),
  detection_id INT,
  CONSTRAINT alertes_detection_id_fkey
    FOREIGN KEY (detection_id) REFERENCES detections(id_detection)
);