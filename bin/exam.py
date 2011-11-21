#!/usr/bin/python3.1

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


import re
from textile import textile
import examparser
import sys
import os

class ExamError(Exception):
	def __init__(self,message,hint=''):
		self.message = message
		self.hint = hint
	
	def __str__(self):
		msg = self.message
		if self.hint:
			msg += '\nPossible fix: '+self.hint
		return msg

#data is a DATA object. attr is either a single variable name or a list of names. obj is the object to load the data into. altname is the name of the object property to fill, if different from attr
#if attr is in data, then obj.attr = data[attr], otherwise no change
def tryLoad(data,attr,obj,altname=''):
	if type(attr)==list:
		for x in attr:
			tryLoad(data,x,obj)
		return
	else:
		if not altname:
			altname = attr
		attr = attr.lower()
		if attr in data:
			if type(obj)==dict:
				obj[altname]=data[attr]
			else:
				setattr(obj,altname,data[attr])

#convert a textile block of content into html, wrapped in a <content> tag and optionally an <html> tag too.
def makeContentNode(s,doTextile=True):
	s=str(s)
	s='\n'.join([x.lstrip() for x in s.split('\n')])	#textile doesn't like whitespace at the start of a line, but I do
	if doTextile:
		s=textile(s)
	else:
		s = re.sub(r'&(?!#?\w+;)','&amp;',s)
		s='<span>'+s+'</span>'
	return etree.fromstring('<content>'+s+'</content>')

#exam object
class Exam:
	name = ''						#title of exam
	duration = 0					#allowed time for exam, in seconds
	percentPass = 0					#percentage classified as a pass
	shuffleQuestions = False		#randomise question order?
	showactualmark = True			#show student's score to student?
	showtotalmark = True			#show total marks available to student?
	showanswerstate = True			#show right/wrong on questions?
	allowrevealanswer = True		#allow student to reveal answer to question?
	adviceType = 'onreveal'			#when is advice shown? 'onreveal' only option at the moment
	adviceThreshold = 0		#reveal advice if student scores less than this percentage

	def __init__(self,name='Untitled Exam'):
		self.name = name
		self.navigation = {	
				'allowregen': False,				#allow student to re-randomise a question?
				'reverse': True,
				'browse': True,
				'showfrontpage': True,
				'onadvance': Event('onadvance','none','You have not finished the current question'),
				'onreverse': Event('onreverse','none','You have not finished the current question'),
				'onmove': Event('onmove','none','You have not finished the current question')
			}

		self.timing = { 
				'timeout': Event('timeout','none',''),
				'timedwarning': Event('timedwarning','none','')
			}

		self.rulesets = {}

		self.functions = []
		self.variables = []
		
		self.questions = []

		self.resources = []
		self.extensions = []
	
	@staticmethod
	def fromstring(string):
		try:
			data = examparser.ExamParser().parse(string)
			exam = Exam.fromDATA(data)
			return exam
		except examparser.ParseError as err:
			print('Parse error: ',str(err))
			raise

	@staticmethod
	def fromDATA(data):
		exam = Exam()
		tryLoad(data,['name','duration','percentPass','shuffleQuestions','resources','extensions'],exam)

		if 'navigation' in data:
			nav = data['navigation']
			tryLoad(nav,['allowregen','reverse','browse','showfrontpage'],exam.navigation)
			for event in ['onadvance','onreverse','onmove']:
				if event in nav:
					tryLoad(nav[event],['action','message'],exam.navigation[event])

		if 'timing' in data:
			timing = data['timing']
			for event in ['timeout','timedwarning']:
				if event in timing:
					tryLoad(timing[event],['action','message'],exam.timing[event])

		if 'feedback' in data:
			tryLoad(data['feedback'],['showactualmark','showtotalmark','showanswerstate','allowrevealanswer'],exam)
			if 'advice' in data['feedback']:
				advice = data['feedback']['advice']
				tryLoad(advice,'type',exam,'adviceType')
				tryLoad(advice,'threshold',exam,'adviceThreshold')

		if 'rulesets' in data:
			rulesets = data['rulesets']
			for name in rulesets.keys():
				l=[]
				for rule in rulesets[name]:
					if isinstance(rule,str):
						l.append(rule)
					else:
						l.append(SimplificationRule.fromDATA(rule))
				exam.rulesets[name] = l

		if 'functions' in data:
			functions = data['functions']
			for function in functions.keys():
				exam.functions.append(Function.fromDATA(function,functions[function]))

		if 'variables' in data:
			variables = data['variables']
			for variable in variables.keys():
				exam.variables.append(Variable(variable,variables[variable]))

		if 'questions' in data:
			for question in data['questions']:
				exam.questions.append(Question.fromDATA(question))

		return exam


	#return a simplified object suitable for putting into JSON/.exam format
	def export(self):
		obj = {
			'name': self.name,
			'percentPass': self.percentPass,
			'shuffleQuestions': self.shuffleQuestions,
			'duration': self.duration,
			'settings': {
				'navigation': {
					'allowregen': self.navigation['allowregen'],
					'reverse': self.navigation['reverse'],
					'browse': self.navigation['browse'],
					'showFrontPage': self.navigation['showfrontpage'],
					'events': {
						'advance': self.navigation['onadvance'].export(),
						'reverse': self.navigation['onreverse'].export(),
						'move': self.navigation['onmove'].export()
					}
				},
				'timing': {
					'timeout': self.timing['timeout'].export(),
					'timedwarning': self.timing['timedwarning'].export()
				},
				'feedback': {
					'showActualMark': self.showactualmark,
					'showTotalMark': self.showtotalmark,
					'showAnswerState': self.showanswerstate,
					'allowRevealAnswer': self.allowrevealanswer,
				},
				'rulesets': { name: [rule.export() if isinstance(rule,SimplificationRule) else rule for rule in rules] for name,rules in self.rulesets.items() }
			},
			'functions': { function.name: function.export() for function in self.functions },
			'variables': { variable.name: variable.definition for variable in self.variables },
			'questions': [ q.export() for q in self.questions ]
		}
		return obj

class SimplificationRule:
	pattern = ''
	result = ''

	def __init__(self):
		self.conditions = []

	@staticmethod
	def fromDATA(data):
		rule=SimplificationRule()
		tryLoad(data,['pattern','conditions','result'],rule)
		return rule

	def export(self):
		return {
			'pattern': self.pattern,
			'result': self.result,
			'conditions': self.conditions
		}


class Event:
	kind = ''
	action = 'none'
	message = ''

	def __init__(self,kind,action,message):
		self.kind = kind
		self.action = action
		self.message = message

	def export(self):
		return {
			'action': self.action,
			'message': self.message
		}

class Question:
	name = 'Untitled Question'
	statement =''
	advice = ''

	def __init__(self,name='Untitled Question'):
		self.name = name

		self.parts = []
		self.variables = []
		self.functions = []

	@staticmethod
	def fromDATA(data):
		question = Question()
		tryLoad(data,['name','statement','advice'],question)

		if 'parts' in data:
			parts = data['parts']
			for part in parts:
				question.parts.append(Part.fromDATA(part))

		if 'variables' in data:
			variables = data['variables']
			for variable in variables.keys():
				question.variables.append(Variable(variable,variables[variable]))
		
		if 'functions' in data:
			functions = data['functions']
			for function in functions.keys():
				question.functions.append(Function.fromDATA(function,functions[function]))

		return question

	def export(self):
		return {
			'name': self.name,
			'statement': self.statement,
			'advice': self.advice,
			'parts': [part.export() for part in self.parts],
			'variables': { variable.name: variable.definition for variable in self.variables },
			'functions': { function.name: function.export() for function in self.functions }
		}

class Variable:
	name = ''
	definition = ''

	def __init__(self,name,definition):
		self.name = name
		self.definition = definition
	
class Function:
	name = ''
	type = ''
	definition = ''

	def __init__(self,name):
		self.name = name
		self.parameters = {}
	
	@staticmethod
	def fromDATA(name,data):
		function = Function(name)
		tryLoad(data,['parameters','type','definition'],function)
		return function
	
	def export(self):
		return {
			'type': self.type,
			'definition': self.definition,
			'parameters': [{name: x[0], type: x[1]} for x in self.parameters]
		}

class Part:
	prompt = ''
	kind = ''
	stepsPenalty = 0
	enableMinimumMarks = True
	minimumMarks = 0

	def __init__(self,marks,prompt=''):
		self.marks = marks
		self.prompt = prompt
		self.steps = []

	@staticmethod
	def fromDATA(data):
		kind = data['type'].lower()
		partConstructors = {
				'jme': JMEPart,
				'numberentry': NumberEntryPart,
				'patternmatch': PatternMatchPart,
				'1_n_2': MultipleChoicePart,
				'm_n_2': MultipleChoicePart,
				'm_n_x': MultipleChoicePart,
				'gapfill': GapFillPart,
				'information': InformationPart
			}
		if not kind in partConstructors:
			raise ExamError(
				'Invalid part type '+kind,
				'Valid part types are '+', '.join(sorted([x for x in partConstructors]))
			)
		part = partConstructors[kind].fromDATA(data)

		tryLoad(data,['stepsPenalty','minimumMarks','enableMinimumMarks'],part);

		if 'marks' in data:
			part.marks = data['marks']

		if 'prompt' in data:
			part.prompt = data['prompt']

		if 'steps' in data:
			steps = data['steps']
			for step in steps:
				part.steps.append(Part.fromDATA(step))

		return part
	
	def export(self):
		return {
			'type': self.kind,
			'marks': self.marks,
			'prompt': self.prompt,
			'stepspenalty': self.stepsPenalty,
			'enableminimummarks': self.enableMinimumMarks,
			'minimummarks': self.minimumMarks,
			'steps': [step.export() for step in self.steps]
		}


class JMEPart(Part):
	kind = 'jme'
	answer = ''
	answerSimplification = 'unitFactor,unitPower,unitDenominator,zeroFactor,zeroTerm,zeroPower,collectNumbers,zeroBase,constantsFirst,sqrtProduct,sqrtDivision,sqrtSquare,otherNumbers'
	checkingType = 'RelDiff'
	checkingAccuracy = 0		#real default value depends on checkingtype - 0.0001 for difference ones, 5 for no. of digits ones
	failureRate = 1
	vsetRangeStart = 0
	vsetRangeEnd = 1
	vsetRangePoints = 5

	def __init__(self,marks=0,prompt=''):
		Part.__init__(self,marks,prompt)

		self.maxLength = Restriction('maxlength',0,'Your answer is too long.')
		self.maxLength.length = 0
		self.minLength = Restriction('minlength',0,'Your answer is too short.')
		self.minLength.length = 0
		self.mustHave = Restriction('musthave',0,'Your answer does not contain all required elements.')
		self.notAllowed = Restriction('notallowed',0,'Your answer contains elements which are not allowed.')
	
	@staticmethod
	def fromDATA(data):
		part = JMEPart()
		tryLoad(data,['answer','answerSimplification','checkingType','failureRate','vsetRangePoints'],part)

		#default checking accuracies
		if part.checkingType.lower() == 'reldiff' or part.checkingType.lower() == 'absdiff':
			part.checkingAccuracy = 0.0001
		else:	#dp or sigfig
			part.checkingAccuracy = 5
		#get checking accuracy from data, if defined
		tryLoad(data,'checkingAccuracy',part)

		if 'maxlength' in data:
			part.maxLength = Restriction.fromDATA('maxlength',data['maxlength'],part.maxLength)
		if 'minlength' in data:
			part.minLength = Restriction.fromDATA('minlength',data['minlength'],part.minLength)
		if 'musthave' in data:
			part.mustHave = Restriction.fromDATA('musthave',data['musthave'],part.mustHave)
		if 'notallowed' in data:
			part.notAllowed = Restriction.fromDATA('notallowed',data['notallowed'],part.notAllowed)

		if 'vsetrange' in data and len(data['vsetrange']) == 2:
			part.vsetRangeStart = data['vsetrange'][0]
			part.vsetRangeEnd = data['vsetrange'][1]

		return part

	def export(self):
		obj = super(JMEPart,self).export()
		obj.update({
			'answer': {
				'correctAnswer': self.answer,
				'answerSimplification': self.answerSimplification,
				'checking': {
					'checkingType': self.checkingType,
					'checkingAccuracy': self.checkingAccuracy,
					'failureRate': self.failureRate,
					'range': {
						'start': self.vsetRangeStart,
						'end': self.vsetRangeEnd,
						'points': self.vsetRangePoints
					},
				},
				'maxLength': self.maxLength.export(),
				'minLength': self.minLength.export(),
				'mustHave': self.mustHave.export(),
				'notAllowed': self.notAllowed.export()
			}
		})
		return obj

class Restriction:
	message = ''
	length = -1
	showStrings = False

	def __init__(self,name='',partialCredit=0,message=''):
		self.name = name
		self.strings = []
		self.partialCredit = partialCredit
		self.message = message
	
	@staticmethod
	def fromDATA(name,data,restriction=None):
		if restriction==None:
			restriction = Restriction(name)
		tryLoad(data,['showStrings','partialCredit','message','length'],restriction)
		if 'strings' in data:
			for string in data['strings']:
				restriction.strings.append(string)

		return restriction

	def export(self):
		obj = {
			'message': self.message,
			'partialcredit': self.partialCredit
		}

		if self.length>=0:
			obj['length']=self.length

		if len(self.strings)>0:
			obj['strings'] = self.strings
			obj['showStrings'] = self.showStrings

		return obj

class PatternMatchPart(Part):
	kind = 'patternmatch'
	caseSensitive = False
	partialCredit = 0
	answer = ''
	displayAnswer = ''

	def __init__(self,marks=0,prompt=''):
		Part.__init__(self,marks,prompt)

	@staticmethod
	def fromDATA(data):
		part = PatternMatchPart()
		tryLoad(data,['caseSensitive','partialCredit','answer','displayAnswer'],part)

		return part

	def export(self):
		obj = super(PatternMatchPart,self).export()
		obj.update({
			'displayAnswer': self.displayAnswer,
			'correctAnswer': self.answer,
			'caseSensitive': self.caseSensitive,
			'partialCredit': self.partialCredit
		})
		return obj

class NumberEntryPart(Part):
	kind = 'numberentry'
	integerAnswer = False
	partialCredit = 0
	minvalue = 0
	maxvalue = 0
	inputStep = 1

	def __init__(self,marks=0,prompt=''):
		Part.__init__(self,marks,prompt)
	
	@staticmethod
	def fromDATA(data):
		part = NumberEntryPart()
		tryLoad(data,['integerAnswer','partialCredit','minvalue','maxvalue','inputStep'],part)
		if 'answer' in data:
			part.maxvalue = part.minvalue = data['answer']

		return part

	def export(self):
		obj = super(NumberEntryPart,self).export()
		obj.update({
			'answer': {
				'minValue': self.minvalue,
				'maxValue': self.maxvalue,
				'inputStep': self.inputStep,
				'integerAnswer': self.integerAnswer,
				'partialCredit': self.partialCredit
			}
		})
		return obj

class MultipleChoicePart(Part):
	minMarksEnabled = False
	minMarks = 0
	maxMarksEnabled = False
	maxMarks = 0
	minAnswers = 0
	maxAnswers = 0
	shuffleChoices = False
	shuffleAnswers = False
	displayType = 'radiogroup'
	displayColumns = 1
	warningType = 'warn'
	warningMessage = 'You have not selected the correct number of choices.'
	
	def __init__(self,kind,marks=0,prompt=''):
		self.kind = kind
		Part.__init__(self,marks,prompt)

		self.choices = []
		self.answers = []
		self.matrix = []

		self.distractors = []

	@staticmethod
	def fromDATA(data):
		kind = data['type']
		part = MultipleChoicePart(kind)
		displayTypes = {
				'1_n_2': 'radiogroup',
				'm_n_2': 'checkbox',
				'm_n_x': 'radiogroup'
		}

		part.displayType = displayTypes[kind]
		tryLoad(data,['minMarks','maxMarks','minAnswers','maxAnswers','shuffleChoices','shuffleAnswers','displayType','displayColumns','warningType','warningMessage'],part)

		if 'choices' in data:
			for choice in data['choices']:
				part.choices.append(choice)

		if 'answers' in data:
			for answer in data['answers']:
				part.answers.append(answer)
	
		if 'matrix' in data:
			part.matrix = data['matrix']
			if not isinstance(part.matrix[0],list):	#so you can give just one row without wrapping it in another array
				part.matrix = [[x] for x in part.matrix]

		if 'distractors' in data:
			part.distractors = data['distractors']
			if not isinstance(part.distractors[0],list):
				part.distractors = [[x] for x in part.distractors]

		return part

	def export(self):
		obj = super(MultipleChoicePart,self).export()
		obj.update({
			'minMarks': self.minMarks,
			'maxMarks': self.maxMarks,
			'minAnswers': self.minAnswers,
			'maxAnswers': self.maxAnswers,
			'shuffleChoices': self.shuffleChoices,
			'shuffleAnswers': self.shuffleAnswers,
			'displayType': self.displayType,
			'displayColumns': self.displayColumns,
			'warningType': self.warningType,
			'warningMessage': self.warningMessage,
			'choices': self.choices,
			'answers': self.answers,
			'matrix': self.matrix,
			'distractors': self.distractors
		})
		return obj

class InformationPart(Part):
	kind = 'information'

	def __init__(self,prompt=''):
		Part.__init__(self,0,prompt)
	
	@staticmethod
	def fromDATA(data):
		return InformationPart()

class GapFillPart(Part):
	kind = 'gapfill'

	def __init__(self,prompt=''):
		Part.__init__(self,0,prompt)
		
		self.gaps = []

	@staticmethod
	def fromDATA(data):
		part = GapFillPart()

		if 'gaps' in data:
			gaps = data['gaps']
			for gap in gaps:
				part.gaps.append(Part.fromDATA(gap))

		return part
	
	def export(self):
		obj = super(GapFillPart,self).export()
		obj.update({
			'gaps': [gap.export() for gap in self.gaps]
		})
		return obj
