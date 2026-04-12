import sys
import time
import json
import subprocess
import speech_recognition as sr
import pyttsx3
import ollama
from duckduckgo_search import DDGS
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

# ==============================================================================
# Initialization
# ==============================================================================
MODEL_NAME = 'llama3.2'
WAKE_WORD = 'jarvis'

# Initialize Text-to-Speech
print("[*] Initializing audio subsystems...")
engine = pyttsx3.init()
voices = engine.getProperty('voices')

print(f"[*] Checking local Ollama engine for model '{MODEL_NAME}'...")
try:
    ollama.show(MODEL_NAME)
    print(f"[*] Model '{MODEL_NAME}' found.")
except Exception:
    print(f"[!] Model '{MODEL_NAME}' not found. Pulling. This will take a while...")
    ollama.pull(MODEL_NAME)
    print(f"[*] Download complete.")

# Try to find a male voice or a decent default
for voice in voices:
    if 'zira' in voice.name.lower() or 'david' in voice.name.lower():
        engine.setProperty('voice', voice.id)
        break
engine.setProperty('rate', 170)

def speak(text):
    print(f"Jarvis: {text}")
    engine.say(text)
    engine.runAndWait()

# Initialize Speech Recognition
recognizer = sr.Recognizer()
has_mic = False
try:
    microphone = sr.Microphone()
    with microphone as source:
        recognizer.adjust_for_ambient_noise(source)
        print("[*] Calibrated microphone.")
    has_mic = True
except Exception as e:
    print(f"[!] Warning: Audio input disabled ({str(e)}). Falling back to text input.")

# ==============================================================================
# AI Autonomous Tools
# ==============================================================================
def search_web(query: str) -> str:
    """Useful for answering questions about current events, facts, or performing a web search."""
    print(f"[*] Executing Web Search for: {query}")
    results = DDGS().text(query, max_results=3)
    if not results:
        return "No results found for that query."
    output = []
    for r in results:
        output.append(f"Title: {r['title']}\nSnippet: {r['body']}\nLink: {r['href']}")
    return "\n\n".join(output)

def crawl_website(url: str) -> str:
    """Useful to open a browser and read the full text content of a specific web URL."""
    print(f"[*] Crawling URL: {url}")
    try:
        chrome_options = Options()
        chrome_options.add_argument("--headless")  # Run invisible to avoid popping up constantly
        
        driver = webdriver.Chrome(options=chrome_options)
        driver.get(url)
        time.sleep(2) # allow js to load
        
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        # Extract text clearly without all html tags
        text = ' '.join([p.text for p in soup.find_all(['p', 'h1', 'h2', 'h3'])])
        driver.quit()
        return text[:3000] # Cap length so context window doesn't explode
    except Exception as e:
        return f"Error crawling {url}: {str(e)}"

def run_shell_command(command: str) -> str:
    """Useful to run powershell or terminal commands on the user's PC, install packages, write files, or check system states."""
    print(f"[*] Running System Command: {command}")
    try:
        result = subprocess.check_output(command, shell=True, text=True, stderr=subprocess.STDOUT)
        return result[:2000] # Cap output
    except Exception as e:
        return f"Failed to execute. Error: {str(e)}"

# Map of tool functions
available_tools = {
    'search_web': search_web,
    'crawl_website': crawl_website,
    'run_shell_command': run_shell_command
}

# ==============================================================================
# Agent Loop
# ==============================================================================
# The conversation memory
messages = [
    {"role": "system", "content": "You are Jarvis, a highly capable autonomous AI assistant. You run completely locally with full administration rights over the user's Windows PC. You can search the web, open chrome, execute terminal commands, and speak. Keep your verbal responses incredibly concise and to the point. If asked to do something complex, use your tools silently to accomplish it before responding."}
]

def process_prompt(prompt_text):
    print(f"\nUser: {prompt_text}")
    messages.append({"role": "user", "content": prompt_text})
    
    # Let Ollama handle the loop
    while True:
        try:
            response = ollama.chat(
                model=MODEL_NAME,
                messages=messages,
                tools=[search_web, crawl_website, run_shell_command]
            )
            
            message = response['message']
            messages.append(message)
            
            if not message.get('tool_calls'):
                # No tools to call, we have the final answer
                speak(message['content'])
                break
            
            # Execute all requested tools
            for tool_call in message['tool_calls']:
                tool_name = tool_call['function']['name']
                tool_args = tool_call['function']['arguments']
                
                if tool_name in available_tools:
                    tool_func = available_tools[tool_name]
                    result = tool_func(**tool_args)
                    
                    messages.append({
                        "role": "tool",
                        "content": str(result),
                    })
                
        except Exception as e:
            err = f"Failed to connect to the brain. Is Ollama running {MODEL_NAME}? Error: {str(e)}"
            print(err)
            speak("I'm sorry sir, I am unable to connect to my neural engine.")
            break

# ==============================================================================
# Main Listener Loop
# ==============================================================================
def start_jarvis():
    speak("Jarvis is online. Awaiting commands.")
    print("\n[--- SYSTEM READY ---]")
    
    while True:
        if has_mic:
            with microphone as source:
                try:
                    audio = recognizer.listen(source, timeout=1, phrase_time_limit=3)
                    transcription = recognizer.recognize_google(audio).lower()
                    
                    if WAKE_WORD in transcription:
                        speak("Yes sir?")
                        with microphone as source_cmd:
                            audio_cmd = recognizer.listen(source_cmd, timeout=5, phrase_time_limit=15)
                            command = recognizer.recognize_google(audio_cmd)
                            process_prompt(command)
                except KeyboardInterrupt:
                    break
                except Exception:
                    pass
        else:
            try:
                command = input("\nJarvis> ")
                if command.strip():
                    process_prompt(command)
            except KeyboardInterrupt:
                break

if __name__ == "__main__":
    start_jarvis()
