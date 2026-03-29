import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv
from google import genai


SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_PATH_DEFAULT = SCRIPT_DIR / "reviews_input.json"
OUTPUT_DIR = SCRIPT_DIR / "reviews_output"


def load_env() -> str:
  load_dotenv()
  api_key = os.environ.get("GEMINI_API_KEY")
  if not api_key:
    raise RuntimeError(
      "GEMINI_API_KEY not found. Add it to your .env (next to analyze_reviews.py) "
      "or export GEMINI_API_KEY in your shell."
    )
  return api_key


def load_reviews(input_path: Path) -> List[Dict[str, Any]]:
  if not input_path.exists():
    raise FileNotFoundError(
      f"Input file not found: {input_path}\n"
      "Create an input JSON file with either:\n"
      '  {"reviews": [ { "author_name": "...", "rating": 5, "review_text": "..." }, ... ]}\n'
      "or:\n"
      '  [ { "author_name": "...", "rating": 5, "review_text": "..." }, ... ]'
    )

  # Some generators (like redirecting npm output) may prepend log lines
  # before the actual JSON. Strip everything before the first '{' or '['.
  with input_path.open("r", encoding="utf-8") as f:
    raw_text = f.read()

  start_idx = -1
  for ch in ("{", "["):
    i = raw_text.find(ch)
    if i != -1:
      start_idx = i if start_idx == -1 else min(start_idx, i)
  if start_idx > 0:
    raw_text = raw_text[start_idx:]

  data = json.loads(raw_text)
  if isinstance(data, dict) and "reviews" in data and isinstance(data["reviews"], list):
    return data["reviews"]
  if isinstance(data, list):
    return data
  raise ValueError(
    "reviews_input.json must be either an array of reviews or an object with a 'reviews' array."
  )


def build_prompt(review_text: str, rating: Any) -> str:
  return f"""
You will receive a patient review.

Your task is to analyze the review and generate a structured operational response suitable for creating a support ticket.

IMPORTANT RULES:

- Action must be SPECIFIC to the review.
- Do NOT generate generic compliance statements.
- Do NOT repeat the same action for different reviews.
- Focus on operational next steps, not policy statements.
- If no action is required, clearly say action_required = "No".

STAR-BASED CLASSIFICATION (do NOT add extra fields, just use this to influence action_required and priority):
- If star rating is 4 or 5: treat as mostly positive; action_required is usually "No" unless there is a clear ask.
- If star rating is 3 or below: treat as ticket-worthy; action_required is usually "Yes" unless there is explicitly nothing to do.

Return STRICT JSON in this exact format (these fields only):

{{
  "sentiment": "Positive | Neutral | Negative",
  "issue_category": "Appointment | Billing | Clinical | Lab | Staff Behavior | Infrastructure | Insurance | Other",
  "action_required": "Yes | No",
  "action_description": "Clear operational next step based on THIS review only.",
  "department_to_handle": "One of the existing Call Intelligence departments (use the closest match). Examples: Billing, Emergency, General OPD, Lab, Diagnostics, Radiology, Orthopaedics, Neurosurgery, Cardiology, Pediatrics, Obstetrics & Gynaecology, ICU Department, Pharmacy, Physiotherapy, Home Care Services, Health Check-up Department, Patient Relations, Customer Service, Hospital Administration, Operations Management, Women and Child Department. If no clear match, pick the closest from this set instead of inventing a new name.",
  "priority": "Low | Medium | High",
  "ticket_notes": "2-3 sentence summary of the issue for internal team."
}}

Now analyze the following review (star rating = {rating}):

REVIEW:
\"\"\"{review_text}\"\"\"

Return ONLY the JSON object. No explanations, no markdown, no extra text.
""".strip()


def analyze_single_review(
  client: genai.Client, review: Dict[str, Any], index: int
) -> Dict[str, Any]:
  text = (review.get("review_text") or review.get("text") or "").strip()
  rating = review.get("rating")
  if not text:
    raise ValueError(f"Review #{index + 1} has no review_text.")

  prompt = build_prompt(text, rating)
  response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
  )

  raw = response.text.strip() if hasattr(response, "text") else ""

  # Strip ```json fences if present
  if raw.startswith("```json"):
    raw = raw[7:]
  if raw.startswith("```"):
    raw = raw[3:]
  if raw.endswith("```"):
    raw = raw[:-3]
  raw = raw.strip()

  parsed = json.loads(raw)
  if not isinstance(parsed, dict):
    raise ValueError("Model output is not a JSON object.")

  return parsed


def main() -> None:
  parser = argparse.ArgumentParser(
    description="Analyze patient reviews with Gemini and produce JSON suitable for tickets.",
  )
  parser.add_argument(
    "--input",
    "-i",
    type=str,
    default=str(INPUT_PATH_DEFAULT),
    help="Path to input JSON file (SerpApi output or custom reviews JSON).",
  )
  args = parser.parse_args()

  input_path = Path(args.input).resolve()

  print("Review Analysis Script (Gemini)")
  print("=" * 60)
  print(f"Working directory : {SCRIPT_DIR}")
  print(f"Input file        : {input_path}")
  print(f"Output directory  : {OUTPUT_DIR}")
  print("=" * 60)

  api_key = load_env()
  client = genai.Client(api_key=api_key)

  reviews = load_reviews(input_path)
  print(f"Found {len(reviews)} review(s) to analyze.\n")

  OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

  results: List[Dict[str, Any]] = []
  for idx, review in enumerate(reviews):
    print(f"Review {idx + 1}/{len(reviews)} …")
    try:
      analysis = analyze_single_review(client, review, idx)
      combined = {
        "index": idx,
        "author_name": review.get("author_name"),
        "rating": review.get("rating"),
        "review_text": review.get("review_text") or review.get("text"),
        "analysis": analysis,
      }
      results.append(combined)

      # Save per-review JSON (similar to per-audio JSON)
      base_name = review.get("author_name") or f"review_{idx+1}"
      safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(base_name))
      out_path = OUTPUT_DIR / f"{idx+1:03d}_{safe_name}.json"
      with out_path.open("w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2, ensure_ascii=False)
      print(f"  Saved: {out_path}")
    except Exception as e:  # noqa: BLE001
      print(f"  ERROR for review {idx + 1}: {e}")

  # Also save a single aggregate file
  aggregate_path = OUTPUT_DIR / "reviews_analysis.json"
  with aggregate_path.open("w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

  print("\n" + "=" * 60)
  print("Done.")
  print(f"Per-review JSON files: {OUTPUT_DIR}")
  print(f"Aggregate JSON       : {aggregate_path}")
  print("=" * 60)


if __name__ == "__main__":
  main()

