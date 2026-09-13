import subprocess

def make_silence(duration, name):
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", 
        "-t", str(duration), "-q:a", "9", "-acodec", "libmp3lame", name
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

print("Generating silences...")
make_silence(1.0, "silence_1.0.mp3")
make_silence(1.5, "silence_1.5.mp3")
make_silence(2.0, "silence_2.0.mp3")
make_silence(2.44, "silence_2.44.mp3")

gaps = [1.5, 1.5, 2.0, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]
start_pad = 1.0
end_pad = 2.44

with open("concat.txt", "w") as f:
    f.write(f"file 'silence_{start_pad}.mp3'\n")
    for i in range(10):
        f.write(f"file 'audio_block_{i}.mp3'\n")
        if i < 9:
            f.write(f"file 'silence_{gaps[i]}.mp3'\n")
    f.write(f"file 'silence_{end_pad}.mp3'\n")

print("Concatenating audio...")
subprocess.run([
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "final_voiceover.mp3"
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("Done.")
