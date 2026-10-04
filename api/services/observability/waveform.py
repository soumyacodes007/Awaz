"""Compute a bounded waveform once during artifact upload, off the event loop."""

import io
import wave

import numpy as np


def waveform_metadata(data: bytes, max_peaks: int = 2000) -> dict:
    if max_peaks <= 0:
        raise ValueError("max_peaks must be positive")
    peaks = []
    with wave.open(io.BytesIO(data), "rb") as recording:
        channels = recording.getnchannels()
        rate = recording.getframerate()
        frames = recording.getnframes()
        if recording.getsampwidth() != 2:
            return {}
        # Read one display bin at a time. Long recordings must not allocate an
        # additional full-call int32 array for every track during completion.
        count = min(max_peaks, frames)
        previous = 0
        for index in range(count):
            end = (index + 1) * frames // count
            samples = np.frombuffer(recording.readframes(end - previous), dtype="<i2")
            # int32 prevents abs(-32768) from overflowing; pool all channels.
            peaks.append(
                round(float(np.abs(samples.astype(np.int32)).max()) / 32768, 5)
            )
            previous = end
    return {
        "waveform": peaks,
        "duration_seconds": frames / rate,
        "sample_rate": rate,
        "channels": channels,
    }
