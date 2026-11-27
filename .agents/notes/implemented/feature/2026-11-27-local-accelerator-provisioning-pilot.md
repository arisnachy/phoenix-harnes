# Windows local accelerator provisioning pilot

Status: experimental; not selected by the production inference manager.

The successful managed PowerShell update launches a detached, user-scoped provisioning worker for llama.cpp b10964. It inspects healthy PCI graphics adapters, tries Vulkan first, and considers vendor-specific alternatives if Vulkan cannot enumerate a compute device. It installs at most one candidate per check, verifies upstream SHA-256 digests, stages files under PHOENIX_HOME (default ~/.phoenix), and leaves the existing CPU runtime, installed GGUF models, Ollama and Orión unchanged. CUDA 13.3 remains a benchmark option, not an automatic install target. No system graphics drivers are installed. Set PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL=0 to disable provisioning. Status and installer.log are under local-models/accelerators/b10964; node scripts/phoenix-local-accelerators.mjs --status reads the last recorded result.

Device enumeration is not an inference or throughput test. A crashed worker may leave a lock that requires verified manual cleanup. Windows archive extraction, actual device use, benchmarks, integration into the managed local model lifecycle and CPU fallback during inference remain release gates. Do not promote the draft until those checks pass.
