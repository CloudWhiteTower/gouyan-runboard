"""Opt-in resource sampling. No environment variables or credentials are read."""

import csv
import importlib.util
import io
import platform
import shutil
import subprocess
from importlib.metadata import PackageNotFoundError, version


def environment():
    packages = {}
    for name in (
        "torch",
        "lightning",
        "torch-geometric",
        "numpy",
        "runboard",
        "gouyan-runboard",
    ):
        try:
            packages[name] = version(name)
        except PackageNotFoundError:
            pass
    return {
        "python": platform.python_version(),
        "os": platform.system(),
        "os_release": platform.release(),
        "architecture": platform.machine(),
        "packages": packages,
    }


class Sampler:
    def __init__(self):
        self.process = None
        self.psutil = None
        if importlib.util.find_spec("psutil"):
            import psutil

            self.psutil = psutil
            self.process = psutil.Process()
            self.process.cpu_percent()
            psutil.cpu_percent()
        self.nvidia = shutil.which("nvidia-smi")
        self.devices = []
        self.gpu_status = "unavailable" if not self.nvidia else "pending"

    def collect(self):
        values = {}
        if self.psutil:
            memory = self.psutil.virtual_memory()
            disk = self.psutil.disk_io_counters()
            network = self.psutil.net_io_counters()
            values.update(
                {
                    "system/cpu_percent": self.process.cpu_percent(),
                    "system/memory_mb": self.process.memory_info().rss / 1024**2,
                    "system/host_cpu_percent": self.psutil.cpu_percent(),
                    "system/host_memory_percent": memory.percent,
                }
            )
            if disk:
                values.update(
                    {
                        "system/disk_read_mb": disk.read_bytes / 1024**2,
                        "system/disk_write_mb": disk.write_bytes / 1024**2,
                    }
                )
            if network:
                values.update(
                    {
                        "system/network_sent_mb": network.bytes_sent / 1024**2,
                        "system/network_received_mb": network.bytes_recv / 1024**2,
                    }
                )
        if self.nvidia:
            try:
                result = subprocess.run(
                    [
                        self.nvidia,
                        "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                        "--format=csv,noheader,nounits",
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=3,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except (OSError, subprocess.TimeoutExpired):
                self.gpu_status = "unavailable"
                return values
            self.gpu_status = "available" if result.returncode == 0 else "unavailable"
            if result.returncode == 0:
                self.devices = []
                for row in csv.reader(io.StringIO(result.stdout)):
                    index, name, *numbers = [part.strip() for part in row]
                    self.devices.append({"index": index, "name": name})
                    for key, number in zip(
                        (
                            "utilization_percent",
                            "memory_used_mb",
                            "memory_total_mb",
                            "temperature_c",
                            "power_w",
                        ),
                        numbers,
                    ):
                        if number.replace(".", "", 1).isdigit():
                            values[f"system/gpu/{index}/{key}"] = float(number)
        return values
