import fetch from "node-fetch";

async function test() {
    const res = await fetch("http://localhost:8080/api/jobs/run", {
        method: "POST", // ⚡ must be POST
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-user" })
    });

    console.log("HTTP status:", res.status);

    // Only parse JSON if status is 200-range
    if (res.ok) {
        const data = await res.json();
        console.log(data);
    } else {
        const text = await res.text();
        console.log("Server response:", text);
    }
}

test();