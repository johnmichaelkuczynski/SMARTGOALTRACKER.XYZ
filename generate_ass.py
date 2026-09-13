import math

text_blocks = [
    "Meet the Interactive Living Diary.",
    "It turns your daily reflection\\Ninto an ongoing conversation.",
    "There's no separate AI chat—\\Nyou write directly in the unified diary box,",
    "and your informed response\\Nappears right there.",
    "It securely draws on your goals, tasks,\\Nhistory, and documents",
    "to provide a personalized, concise response,\\Nalways kept to one paragraph.",
    "It's enabled by default,\\Nbut you can switch it off anytime",
    "for conventional writing.",
    "You can even start multiple entries\\Non the same date,",
    "each keeping its own\\Nunique conversation history.",
    "It's your diary, reimagined."
]

# Adjust weight for punctuation
chars = [len(t.replace('\\N', ' ')) for t in text_blocks]
pauses = [0.4, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.4]

total_chars = sum(chars)
total_audio_time = 36.85
total_pauses = sum(pauses)

time_for_chars = total_audio_time - total_pauses
time_per_char = time_for_chars / total_chars

current_time = 0.0

def format_time(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    if cs == 100:
        cs = 99
    return f"0:{mins:02d}:{secs:02d}.{cs:02d}"

print("[Script Info]")
print("ScriptType: v4.00+")
print("PlayResX: 1280")
print("PlayResY: 720")
print("ScaledBorderAndShadow: yes")
print("WrapStyle: 2")
print("")
print("[V4+ Styles]")
print("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding")
print("Style: Caption,Arial,30,&H00FFFFFF,&H000000FF,&H0013141A,&HA0000000,-1,0,0,0,100,100,0,0,3,8,0,2,70,70,32,1")
print("")
print("[Events]")
print("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

for i, text in enumerate(text_blocks):
    duration = chars[i] * time_per_char
    start_time = current_time
    end_time = start_time + duration
    
    print(f"Dialogue: 0,{format_time(start_time)},{format_time(end_time)},Caption,,0,0,0,,{text}")
    
    current_time = end_time + pauses[i]
