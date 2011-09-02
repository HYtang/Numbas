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

def encode(xml):
	xml = re.sub('\n|\r','',xml)
	xml = re.sub('\\\\',r'\\\\',xml)
	xml = re.sub('"','\\"',xml)
	return xml

def encodeHandlebars(hbs):
	hbs = re.sub('\n(?!$)',r'\\n',hbs)
	hbs = re.sub('"',r'\"',hbs)
	return hbs.strip()

def makesettings(options):

#include XSLT
	themedir = os.path.join(options.theme,'xslt')

	all = ''
	files = filter(lambda x: x[-5:]=='.xslt', os.listdir(themedir))
	for x in files:
		if len(all):
			all+=',\n\t\t'
		s = x[:-5]+': \"'+encode(open(os.path.join(themedir,x),encoding='utf-8').read())+'\"'
		all+=s

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
Numbas.rawxml = {
	templates: {
		%s
	},

	examXML: \"%s\"
};

Numbas.raw = {
	templates: {
		%s
	},

	examJSON: %s
};
	
});
""" % (str(extensionfiles),all, encode(options.examXML), ',\n\t\t'.join(allHBS), options.examJSON)
	return out

