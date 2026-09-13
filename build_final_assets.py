import subprocess

durations = [1.67, 1.49, 1.25, 3.29, 5.43, 5.88, 4.49, 1.85, 1.33, 1.75]
gaps = [1.5, 1.5, 2.0, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]
start_pad = 1.0
end_pad = 2.44

# 1. Combine audio
filter_str = ""
# Add start pad
filter_str += f"aevalsrc=d={start_pad}:s=44100[start_silence];"
# Pad each block except last
for i in range(9):
    filter_str += f"[{i}:a]apad=pad_dur={gaps[i]}[a{i}];"
# Last block pad
filter_str += f"[9:a]apad=pad_dur={end_pad}[a9];"

# Concat all
filter_str += f"[start_silence]"
for i in range(10):
    filter_str += f"[a{i}]"
filter_str += f"concat=n=11:v=0:a=1[outa]"

cmd = ["ffmpeg", "-y"]
for i in range(10):
    cmd.extend(["-i", f"audio_block_{i}.mp3"])
cmd.extend(["-filter_complex", filter_str, "-map", "[outa]", "final_voiceover.mp3"])

print("Running ffmpeg...")
subprocess.run(cmd, check=True)

# 2. Generate .ass captions
def format_time(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    if cs >= 100:
        cs = 99 # keep it simple
    return f"0:{mins:02d}:{secs:02d}.{cs:02d}"

texts = [
    "Want a diary that talks back?",
    "Want a diary that knows you?",
    "Well, now you have one.",
    "Smart Goal Tracker\\Nisn’t just a calendar.\\NIt works with you.",
    "It knows about you and constantly updates\\Nits understanding of who you are\\Nand what you are trying to do.",
    "It remembers what you have said,\\Nknows how you have grown,\\Nand knows how you can optimize yourself.",
    "Take the Interactive Diary.\\NYou write in your diary—\\Nand it writes back.",
    "And it’s smart because it knows you.",
    "Smart Goal Tracker.",
    "How can we make your life easier?"
]

print("Generating ASS file...")
with open("exports/video-work/smart_goal_tracker_45s_captions.ass", "w") as f:
    f.write("[Script Info]\n")
    f.write("ScriptType: v4.00+\n")
    f.write("PlayResX: 1280\n")
    f.write("PlayResY: 720\n")
    f.write("ScaledBorderAndShadow: yes\n")
    f.write("WrapStyle: 2\n\n")
    f.write("[V4+ Styles]\n")
    f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
    f.write("Style: Caption,Arial,30,&H00FFFFFF,&H000000FF,&H0013141A,&HA0000000,-1,0,0,0,100,100,0,0,3,8,0,2,70,70,32,1\n\n")
    f.write("[Events]\n")
    f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    
    curr_t = start_pad
    for i in range(10):
        start_t = curr_t
        end_t = start_t + durations[i]
        
        f.write(f"Dialogue: 0,{format_time(start_t)},{format_time(end_t)},Caption,,0,0,0,,{texts[i]}\n")
        
        if i < 9:
            curr_t = end_t + gaps[i]

print("Done.")
