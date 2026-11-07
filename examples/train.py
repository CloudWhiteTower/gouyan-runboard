"""Example contract for `runboard worker --study NAME --objective train:objective`.

Run with this directory on PYTHONPATH. Replace train_example with your model's
training loop; return the validation metric to optimize, never test-set metrics.
"""

from runboard.sweeps import train_example


def objective(config, run):
    return train_example(run, config)
