"""CrewAI version of the triage step. Not yet connected to the Express API."""
from crewai import Agent, Task, Crew

triager = Agent(
    role="Support Triage Lead",
    goal="Assign each ticket a priority (P1-P3) and the owning team (Billing, Identity, Product).",
    backstory="You have run support for B2B SaaS for ten years and escalate only true outages as P1.",
    allow_delegation=False,
)

def triage(subject: str, body: str) -> str:
    task = Task(
        description=f"Ticket subject: {subject}\nBody: {body}\nReturn JSON with priority, team and reason.",
        expected_output='{"priority": "P1|P2|P3", "team": "...", "reason": "..."}',
        agent=triager,
    )
    return Crew(agents=[triager], tasks=[task]).kickoff()

if __name__ == "__main__":
    print(triage("Checkout is down for all users", "Error 500 since 9am"))
