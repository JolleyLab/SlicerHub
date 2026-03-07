#!/bin/bash
# Build Python command
CMD="python3 viewer.py --port 9000 --host 0.0.0.0"

# Add file path if provided via environment variable
if [ ! -z "$FILE_PATH" ]; then
    CMD="$CMD --file $FILE_PATH"
fi

# Run the Python application
$CMD
