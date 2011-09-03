#Copyright 2011 Newcastle University
#
#   Licensed under the Apache License, Version 2.0 (the "License");
#   you may not use this file except in compliance with the License.
#   You may obtain a copy of the License at
#
#       http://www.apache.org/licenses/LICENSE-2.0
#
#   Unless required by applicable law or agreed to in writing, software
#   distributed under the License is distributed on an "AS IS" BASIS,
#   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#   See the License for the specific language governing permissions and
#   limitations under the License.

import os
import re
import sys

def encodeHandlebars(hbs):
	hbs = re.sub('\n(?!$)',r'\\n',hbs)
	hbs = re.sub('"',r'\"',hbs)
	return hbs.strip()

def makesettings(options):

#include handlebars templates
	themedir = os.path.join(options.theme,'templates')

	allHBS = []
	files = filter(lambda x: x[-4:]=='.hbs', os.listdir(themedir))
	for x in files:
		s = x[:-4]+': \"'+encodeHandlebars(open(os.path.join(themedir,x),encoding='utf-8').read())+'\"'
		allHBS.append(s)

#include javascript files to go with extensions
	extensionfiles = ['extensions/'+x+'/'+x+'.js'for x in [os.path.split(y)[1] for y in options.extensions]]

	out = """Numbas.queueScript('settings.js',%s,function() {
Numbas.raw = {
	templates: {
		%s
	},

	examJSON: %s
};
	
});
""" % (str(extensionfiles),',\n\t\t'.join(allHBS), options.examJSON)
	return out

