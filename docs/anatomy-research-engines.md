# PHOENIX Anatomical Research Engines

English | [中文](anatomy-research-engines.zh.md)

PHOENIX research-only anatomical simulation adapters require original medical imagery, expert-prepared geometry and physical parameters. ECG, radiographs and GLB renderings do not provide those inputs.

## Executable integrations

- SimVascular 0D: svZeroDSolver accepts clinician-prepared vascular-network JSON and produces CSV. Optional isolated svzerod==3.2 setup is attempted; 3D CFD also needs a prepared mesh, units, boundary conditions and validated solver configuration.
- openCARP: run openCARP -par CONFIG -simID OUTPUT on Linux or WSL2 Ubuntu 24.04 with an expert-prepared mesh and parameter file. The result is research output, not clinical electrophysiology.
- SimVascular GUI: start the installed native Linux GUI or an official WSL SimVascular binary. Neither a GUI launch nor a successful process exit confirms a valid simulation.
- Anatomical tasks: scripts/phoenix-anatomy-models.json names vetted TotalSegmentator tasks and modalities. Small peripheral nerves, myocardial scar, cerebral tracts and coronary microvasculature need separately validated models or expert masks.

## Operator commands

Check node scripts/phoenix-anatomy-simulation.mjs doctor and node scripts/phoenix-anatomy-workbench.mjs doctor. List tasks with node scripts/phoenix-anatomy-workbench.mjs models. Reconstruct with: node scripts/phoenix-anatomy-workbench.mjs reconstruct --input STUDY --output PRIVATE --modality ct --task ct_general --research-only --view. Compare NIfTI labels with: node scripts/phoenix-anatomy-workbench.mjs validate --pred PRED --reference REFERENCE --output QA.json --research-only.

For vascular solver: node scripts/phoenix-anatomy-simulation.mjs run --engine svzerod --input INPUT.json --output RESULTS.csv --research-only. For electrophysiology: --engine opencarp --input INPUT.par --output OUTPUT-DIRECTORY --research-only. For the GUI: set PHOENIX_SIMVASCULAR_BIN to the official executable and use launch --engine simvascular.

For a fully prepared SimVascular finite-element project, run: node scripts/phoenix-anatomy-simulation.mjs run --engine svmultiphysics --input PROJECT/solver.xml --output PROJECT/1-procs --research-only. The output directory must not exist. On Windows, WSL2 executes the official svmultiphysics solver from the project's converted Linux path. Neither the XML nor boundary conditions are inferred from GLB or ECG.

## Scientific validation

Reference-mask quality reports Dice, HD95, sensitivity, volume and spatial alignment. Such metrics never establish diagnosis or regulatory approval. A clinician-led validation requires a preregistered protocol, representative external data, uncertainty, subgroup review, adverse failure cases, appropriate imaging quality and signed clinical review. Physical simulations additionally require convergence analysis, patient-specific boundary conditions, dimensional units and measured-physiology comparison.

## Platform and safety

Windows execution of current SimVascular and openCARP depends on WSL2 or supported containers. The openCARP card in PHOENIX Settings > Plugins > Anatomical Connectors explicitly installs the official Docker image (docker.opencarp.org/opencarp/opencarp:latest) if Docker Desktop is already installed and running. The installer verifies openCARP -buildinfo inside the container and records its immutable image ID; the research-only simulation adapter runs the verified image with networking disabled and the operator's prepared input directory read-only. Existing verified WSL2/Linux installations are reused. PHOENIX never silently installs Docker Desktop/WSL2, elevates permissions, marks a failed install ready, or installs Meshalyzer with the simulator. Install and start Docker Desktop first if the prerequisite check says it is missing. SimVascular remains an externally configured engine. Models and licenses vary by modality, task and intended use. Patient source imaging remains only in approved local or institutional storage; never in chat history or public repositories.
