# Create local folder if not already present.
if [ ! -d local ]
then
    mkdir local
fi

cat \
    standalone-jme/stub-numbas.js \
    runtime/scripts/math.js \
    runtime/scripts/util.js \
    runtime/scripts/jme.js \
    runtime/scripts/jme-display.js \
    > local/expr-to-latex.js

python standalone-jme/yaml-to-json.py

# Use -f to execute these two script files.
js -f local/expr-to-latex.js -f standalone-jme/testit.js