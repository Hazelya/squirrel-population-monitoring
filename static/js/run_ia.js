import { fetchRunIA, fetchAlertes, fetchDetections, fetchWorkflowStatus, fetchSetAlerte} from "./fetch.js";


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runIA() {

    try {
        const response = await fetchRunIA();

        if (!response.success) {
            alert("Erreur : " + response.status_code);
            return;
        }

        alert("Analyse IA lancée : une notification apparaitra pour vous prévenir de la fin de l'analyse");

        // attendre la fin du workflow
        let finished = false;
        while (!finished) {
            const status = await fetchWorkflowStatus();
            if (
                status.status === "completed"
            ) {
                finished = true;
                if (status.conclusion !== "success") {
                    alert("Erreur durant l'analyse IA");
                    return;
                }
            }
            if (!finished) {
                await sleep(5000);
            }
        }
        alert("Création des alertes : Appuyer sur ok et ne toucher à rien durant quelques secondes :)");
        await createAlertes();
        alert("Analyse IA terminée !");

    } catch (e) {
        console.error(e);
        alert("Erreur réseau");
    }
}


export async function createAlertes() {

    try {

        const detections = await fetchDetections();
        const alertes = await fetchAlertes();

        // crée un Set des détections déjà traitées
        const existingAlertes = new Set(
            alertes.map(a =>
                `${a.id_detection}-${a.type_alerte}`
            )
        );

        for (const detection of detections) {
            // alerte malade
            if (detection.malade) {
                const key = `${detection.id_detection}-malade`;
                if (!existingAlertes.has(key)) {
                    await fetchSetAlerte(
                        detection.id_detection,
                        "individu malade",
                        new Date().toISOString().split("T")[0], // Attention au format pour l'url Flask
                        "nouvelle"
                    );
                }
            }

            // alerte tamia corée
            if (detection.clip_labels && detection.clip_labels.length > 0) {
                const best = detection.clip_labels.reduce(
                    (max, item) =>
                        item.confidence > max.confidence ? item : max,
                    detection.clip_labels[0]
                );
                console.log(best.species)
                if (best.species.toLowerCase().includes("écureuil de corée")) {
                    const key = `${detection.id_detection}-tamia_coree`;
                    if (!existingAlertes.has(key)) {
                            await fetchSetAlerte(
                            detection.id_detection,
                            "Tamia de corée",
                            new Date().toISOString().split("T")[0], // Attention au format pour l'url Flask
                            "nouvelle"
                        );
                    }
                }
            }
        }

    } catch (e) {

        console.error(e);
        alert("Erreur création alertes");
    }
}

