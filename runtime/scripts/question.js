/*
Copyright 2011 Newcastle University

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/


Numbas.queueScript('scripts/question.js',['schedule','display','jme','jme-variables','util','scorm-storage'],function() {

var util = Numbas.util;
var jme = Numbas.jme;

var job = Numbas.schedule.add;

var Question = Numbas.Question = function( json, number, loading, gvariables, gfunctions )
{
	var q = this;
	q.json = json;
	q.number = number;

	var tryLoad = function(path,to){
		to = to || q;
		return Numbas.json.tryLoad(path,to,json);
	};

	//make functions and merge with global functions list
	job(function() {
		q.functions = Numbas.jme.variables.makeFunctions(q.json.functions);
		for(var f in gfunctions)
		{
			if(!(f in q.functions))
				q.functions[f] = gfunctions[f];
		}
	});

	//make variables and merge with global variables list
	job(function() {
		if(loading)
		{
			q.variables = {};
			var qobj = Numbas.store.loadQuestion(q);
			for(var x in qobj.variables)
			{
				q.variables[x] = qobj.variables[x];
			}
		}
		else
		{
			q.variables = Numbas.jme.variables.makeVariables(q.json.variables,q.functions);
		}
		for(var v in gvariables)
		{
			if(!(v in q.variables))
				q.variables[v] = gvariables[v];
		}
	});

	job(function()
	{
		//get question's name, statement and advice
		['name','statement','advice'].map(tryLoad());

		q.adviceThreshold = Numbas.exam.adviceThreshold;
		q.followVariables = {};

		//load parts
		q.parts=new Array();
		q.partDictionary = {};
		for(var j = 0; j<q.json.parts.length; j++)
		{
			var part = createPart(q.json.parts[j], 'p'+j,q,null, loading);
			q.parts[j] = part;
			q.marks += part.marks;
		}
	
		q.subvars();

		//initialise display - get question HTML, make menu item, etc.
		q.display = new Numbas.display.QuestionDisplay(q);
	});

}
Question.prototype = 
{
	json: undefined,
	number: -1,
	name: '',
	
	marks: 0,				//max. marks available for this question
	score: 0,				//student's score on this question
	adviceThreshold: 0,		//percentage score below which the advice is revealed.

	visited: false,			//has this question been seen by the student? For determining if you can jump back to this question, when navigateBrowse is disabled
	answered: false,		//has question been answered satisfactorily?
	submitted: 0,			//number of times question submitted
	adviceDisplayed: false,	//has question advice been displayed?
	revealed: false,		//has correct answer been revealed?

	parts: [],				//array containing all key parts
	partDictionary: {},		//dictionary mapping part addresses to objects

	display: undefined,		//display code

	//sub variables into content and other strings
	subvars: function() {
		var q = this;
		['name','statement','advice'].map(function(x) {
			q[x] = jme.contentsubvars(q[x],q.variables,q.functions);
		});

		for(var i=0;i<this.parts.length;i++)
		{
			this.parts[i].subvars();
		}
	},

	//get the part object corresponding to a path
	getPart: function(path)
	{
		return this.partDictionary[path];
	},

	//trigger advice
	getAdvice: function()
	{
		this.adviceDisplayed = true;
		this.display.showAdvice(true);
		Numbas.store.adviceDisplayed(this);
	},

	//reveal correct answer to student
	revealAnswer: function()
	{
		this.revealed = true;
		this.answered = true;
		
		//display advice if allowed
		this.getAdvice();

		//part-specific reveal code. Might want to do some logging in future? 
		for(var i=0; i<this.parts.length; i++)
			this.parts[i].revealAnswer();

		//display revealed answers
		this.display.revealAnswer();

		this.score = 0;

		this.display.showScore();

		Numbas.store.answerRevealed(this);

		Numbas.exam.updateScore();
	},

	//validate question - returns true if all parts completed
	validate: function()
	{
		var success = true;
		for(i=0; i<this.parts.length; i++)
		{
			success = success && this.parts[i].answered;
		}
		return success;
	},

	//mark the student's answer to a given part/gap/step
	doPart: function(answerList, partRef)
	{
		var part = this.getPart(partRef);
		if(!part)
			throw(new Error("Can't find part "+partRef+"/"));
		part.storeAnswer(answerList);
	},

	//calculate score - adds up all part scores
	calculateScore: function(uiWarning)
	{
		if(this.revealed)
		{
			this.score = 0;
			return 0;
		}

		var tmpScore=0;
		for(var i=0; i<this.parts.length; i++)
		{
			tmpScore += this.parts[i].score;
		}
		
		if( uiWarning!="uwPrevent" )
		{
			this.score = tmpScore;
		}
		else 
		{
			this.score = 0;
		}
	},


	//submit question answers
	submit: function()
	{
		//submit every part
		for(var i=0; i<this.parts.length; i++)
		{
			this.parts[i].submit();
		}

		//validate every part
		//displays warning messages if appropriate, 
		//and returns false if any part is not completed sufficiently
		this.answered = this.validate();

		//keep track of how many times question successfully submitted
		if(this.answered)
			this.submitted += 1;

		//display message about success or failure
		if(! this.answered )
		{
			Numbas.display.showAlert("Can not submit answer - check for errors.");
			this.display.scrollToError();
		}

							
		this.updateScore();

		if(Numbas.exam.adviceType == 'threshold' && 100*this.score/this.marks < this.adviceThreshold )
		{
			this.getAdvice();
		}
	},

	//recalculate score, display, notify storage
	updateScore: function()
	{
		//calculate score - if warning is uiPrevent then score is 0
		this.calculateScore('uwNone');

		//update total exam score
		Numbas.exam.updateScore();

		//display score - ticks and crosses etc.
		this.display.showScore();

		//notify storage
		Numbas.store.submitQuestion(this);
	}

};



function createPart(json, path, question, parentPart, loading)
{
	var type = json.type;
	if(!type)
		throw(new Error("Missing part type attribute"));
	if(partConstructors[type])
	{
		var cons = partConstructors[type];
		var part = new cons(json, path, question, parentPart, loading);
		return part;
	}
	else
	{
		throw(new Error("Unrecognised part type "+type));
	}
}

//base Question Part object
function Part( json, path, question, parentPart, loading )
{
	var p = this;
	var tryLoad = function(path,to){
		to = to || p;
		return Numbas.json.tryLoad(path,to,json);
	};

	//remember JSON
	this.json = json;

	//remember parent question object
	this.question = question;

	//remember parent part object, so scores can percolate up for steps/gaps
	this.parentPart = parentPart;
	
	//remember a path for this part, for stuff like marking and warnings
	this.path = path;
	this.question.partDictionary[path] = this;

	//initialise settings object
	this.settings = util.copyobj(Part.prototype.settings);
	
	['type','marks','prompt'].map(tryLoad());
	this.rawprompt = this.prompt;

	['minimumMarks','enableMinimumMarks','stepsPenalty'].map(tryLoad('',this.settings));

	//initialise gap and step arrays
	this.gaps = [];
	this.steps = [];

	//load steps
	if('steps' in json)
	{
		for(var i=0; i<json.steps.length; i++)
		{
			var step = createPart( json.steps[i], this.path+'s'+i,this.question, this, loading);
			this.steps[i] = step;
			this.stepsMarks += step.marks;
		}
	}

	this.markingFeedback = [];

	//initialise display code
	this.display = new Numbas.display.PartDisplay(this);
}

Part.prototype = {
	json: '',				//JSON defining this part
	question: undefined,	//reference to parent question object
	parentPart: undefined,	//reference to 'parent' part object - GapFillPart if this is a gap, the main keypart if this is a step
	path: '',				//a question-wide unique 'address' for this part 
	type: '',				//this part's type
	marks: 0,				//max. marks available for this part
	stepsMarks: 0,			//marks available in the steps, if any
	credit: 0,				//proportion of availabe marks awarded to student
	score: 0,				//student's score on this part
	markingFeedback: [],	//messages explaining awarded marks

	stagedAnswer: undefined,	//student's answers as visible on screen (not yet submitted)
	answerList: undefined,	//student's last submitted answer
	answered: false,		//has this part been answered

	gaps: [],				//child gapfills, if any
	steps: [],				//child steps, if any
	stepsShown: false,		//have steps for this part been shown?

	settings: 
	{
		stepsPenalty: 0,		//number of marks to deduct when steps shown
		enableMinimumMarks: false,
		minimumMarks: 0		//minimum marks to award
	},			//store part's settings in here

	display: undefined,		//code to do with displaying this part

	subvars: function() {
		this.prompt = jme.contentsubvars(this.rawprompt,this.question.variables,this.question.functions);
		for(var i=0;i<this.steps.length;i++)
		{
			this.steps[i].subvars();
		}
	},

	//give the student a warning about this part
	//might want to do some logging at some point,
	//so this is a method of the part object, which
	//then calls the display code
	giveWarning: function(warning)
	{
		this.display.warning(textile(warning));
	},

	//calculate student's score for given answer.
	calculateScore: function()
	{
		if(this.steps.length && this.stepsShown)
		{
			var oScore = this.score = (this.marks - this.settings.stepsPenalty) * this.credit; 	//score for main keypart

			var stepsScore = 0, stepsMarks=0;
			for(var i=0; i<this.steps.length; i++)
			{
				stepsScore += this.steps[i].score;
				stepsMarks += this.steps[i].marks;
			}

			var stepsFraction = Math.max(Math.min(1-this.credit,1),0);	//any credit not earned in main part can be earned back in steps

			this.score += stepsScore;						//add score from steps to total score


			this.score = Math.min(this.score,this.marks - this.settings.stepsPenalty)	//if too many marks are awarded for steps, it's possible that getting all the steps right leads to a higher score than just getting the part right. Clip the score to avoid this.

			if(this.settings.enableMinimumMarks)								//make sure awarded score is not less than minimum allowed
				this.score = Math.max(this.score,this.settings.minimumMarks);

			if(stepsMarks!=0 && stepsScore!=0)
			{
				if(this.credit==1)
					this.markingComment("Because you received full marks for the part, your answers to the steps aren't counted.");
				else
				{
					var change = this.score - oScore;
					this.markingComment(util.formatString('You were awarded *%s* %s for your answers to the steps.',change,util.pluralise(change,'mark','marks')));
				}
			}
		}
		else
		{
			this.score = this.credit * this.marks;
		}

		if(this.parentPart && !this.parentPart.submitting)
			this.parentPart.calculateScore();
	},

	//update the stored answer from the student (called when student changes their answer, before submitting)
	storeAnswer: function(answerList) {
		this.stagedAnswer = answerList;
		this.display.removeWarnings();
	},

	//submit answer to this part - save answer, mark, update score
	submit: function() {
		this.display.removeWarnings();
		this.credit = 0;
		this.markingFeedback = [];
		this.submitting = true;

		if(this.stepsShown)
		{
			var stepsMax = this.marks - this.settings.stepsPenalty;
			this.markingComment(
				this.settings.stepsPenalty>0 
					? util.formatString('You revealed the steps. The maximum you can score for this part is *%s* %s. Your scores will be scaled down accordingly.',stepsMax,util.pluralise(stepsMax,'mark','marks')) 
					: 'You revealed the steps.');
		}

		if(this.marks==0)
			return;
		if(this.stagedAnswer==undefined || this.stagedAnswer=='')
		{
			this.giveWarning("No answer submitted.");
			this.setCredit(0,'You did not answer this question.');;
			this.answered = false;
		}
		else
		{
			this.answerList = util.copyarray(this.stagedAnswer);
			this.mark();
			this.answered = this.validate();
		}

		if(this.stepsShown)
		{
			for(var i=0;i<this.steps.length;i++)
			{
				this.steps[i].submit();
			}
		}

		this.calculateScore();
		this.question.updateScore();

		if(this.answered)
		{
			this.reportStudentAnswer(this.studentAnswer);
			if(!(this.parentPart && this.parentPart.type=='gapfill'))
				this.markingComment('You scored *'+this.score+'* '+util.pluralise(this.score,'mark','marks')+' for this part.');
		}
		else
			this.reportStudentAnswer('');

		Numbas.store.partAnswered(this);
		this.display.showScore(this.answered);

		this.submitting = false;
	},

	//save the student's answer as a question variable
	//so it can be used for carry-over marking
	reportStudentAnswer: function(answer) {
		var val;
		if(util.isFloat(answer))
			val = new Numbas.jme.types.TNum(answer);
		else
			val = new Numbas.jme.types.TString(answer);
		this.question.followVariables['$'+this.path] = val;
	},

	//function which marks the student's answer
	mark: function() {},

	////////marking feedback helpers
	setCredit: function(credit,message)
	{
		var oCredit = this.credit;
		this.credit = credit;
		this.markingFeedback.push({
			op: 'addCredit',
			credit: this.credit - oCredit,
			message: message
		});
	},

	addCredit: function(credit,message)
	{
		this.credit += credit;
		this.markingFeedback.push({
			op: 'addCredit',
			credit: credit,
			message: message
		});
	},

	multCredit: function(factor,message)
	{
		var oCredit = this.credit
		this.credit *= factor;
		this.markingFeedback.push({
			op: 'addCredit',
			credit: this.credit - oCredit,
			message: message
		});
	},

	markingComment: function(message)
	{
		this.markingFeedback.push({
			op: 'comment',
			message: message
		});
	},

	//is student's answer acceptable?
	validate: function() { return true; },

	//reveal the steps
	showSteps: function()
	{
		this.stepsShown = true;
		this.calculateScore();
		this.display.showSteps();
		this.question.updateScore();
	},

	//reveal the correct answer
	revealAnswer: function()
	{
		this.display.revealAnswer();
		this.answered = true;
		this.setCredit(0);
		this.showSteps();
		for(var i=0; i<this.steps.length; i++ )
		{
			this.steps[i].revealAnswer();
		}
	}

};

//Judged Mathematical Expression
//student enters a string representing a mathematical expression, eg.
//		'x^2+x+1'
//and it is compared with the correct answer by evaluating over a range of values
function JMEPart(json, path, question, parentPart, loading)
{
	var settings = this.settings;
	util.copyinto(JMEPart.prototype.settings,settings,true);

	//parse correct answer from JSON
	settings.correctAnswer = json.answer.correctAnswer;

	if(!settings.correctAnswer)
		throw(new Error("Correct answer for a JME part is missing ("+this.path+")"));

	settings.answerSimplification = Numbas.jme.display.collectRuleset(json.answer.answerSimplification,Numbas.exam.rulesets);

	settings.displaySimplification = {
		fractionNumbers: settings.answerSimplification.fractionNumbers
	};
	
	//get checking type, accuracy, checking range
	var parametersPath = 'answer';
	['checkingType','checkingAccuracy','failureRate'].map(Numbas.json.tryLoad('answer.checking',settings,json));
	['start','end','points'].map(Numbas.json.tryLoad('answer.checking.range',settings.range,json));

	//load string restrictions
	['maxLength','minLength','mustHave','notAllowed'].map(function(x){
		settings[x] = util.copyobj(settings[x]);
		util.copyinto(json.answer[x],settings[x])
	});

	this.display = new Numbas.display.JMEPartDisplay(this);

	if(loading)
	{
		var pobj = Numbas.store.loadPart(this);
		this.studentAnswer = pobj.studentAnswer;
	}
}

JMEPart.prototype = 
{
	studentAnswer: '',

	settings: 
	{
		//string representing correct answer to question
		correctAnswer: '',

		//default simplification rules to use on correct answer
		answerSimplification: ['unitFactor','unitPower','unitDenominator','zeroFactor','zeroTerm','zeroPower','collectNumbers','zeroBase','constantsFirst','sqrtProduct','sqrtDivision','sqrtSquare','otherNumbers'],
		
		//	checking type : SigFig (round answers to x sig figs)
		//					RelDiff (compare ratio of student answer to correct answer)
		//					AbsDiff (compare absolute difference between answers)
		//					Dp (round answers to x decimal places)
		checkingType: 'RelDiff',

		checkingAccuracy: 0,	//accuracy for checking - depends on checking type
		failureRate: 0,			//comparison failures allowed before we decide answers are different

		range: {
			start: 0,		//range to pick variable values from
			end: 1,
			points: 1		//number of points to compare answers on
		},
		
		maxLength: {
			length: 0,				//max length of student's answer
			partialCredit: 0,		//partial credit if student's answer too long
			message: 'Your answer is too long'
		},

		minLength: {
			length: 0,				//min length of student's answer
			partialCredit: 0,		//partial credit if student's answer too short
			message: 'Your answer is too short'
		},

		mustHave: {
			strings: [],			//strings which must be present in student's answer
			partialCredit: 0,		//partial credit if a must-have is missing
			message: '',			//warning message if missing a must-have
			showStrings: false		//tell students which strings must be included?
		},

		notAllowed: {
			strings: [],			//strings which must not be present in student's answer
			partialCredit: 0,		//partial credit if a not-allowed string is present
			message: '',			//warning message if not-allowed string present
			showStrings: false		//tell students which strings are not allowed?
		}
	},

	subvars: function() {
		this.correctAnswer = jme.subvars(this.settings.correctAnswer,this.question.variables,this.question.functions);
	},

	mark: function()
	{
		if(this.answerList==undefined)
		{
			this.setCredit(0,'You did not enter an answer.');
			return false;
		}
		this.studentAnswer = this.answerList[0];

		try
		{
			var simplifiedAnswer = Numbas.jme.display.simplifyExpression(this.studentAnswer);
		}
		catch(e)
		{
			this.setCredit(0,'Your answer is not a valid mathematical expression.');
			return;
		}

		this.failMinLength = (simplifiedAnswer.length<this.settings.minLength.length);
		this.failMaxLength = (this.settings.maxLength.length>0 && simplifiedAnswer.length>this.settings.maxLength.length);
		this.failNotAllowed = false;
		this.failMustHave = false;

		//did student actually write anything?
		this.answered = this.studentAnswer.length > 0;

		
		//do comparison of student's answer with correct answer
		if(!jme.compare(this.studentAnswer, this.correctAnswer, this.settings, this.question.followVariables))
		{
			this.setCredit(0,'Your answer is incorrect.');
			return;
		}

		//see if student answer contains any forbidden strings
		for( i=0; i<this.settings.notAllowed.strings.length; i++ )
		{
			if(this.studentAnswer.contains(this.settings.notAllowed.string[i])) { this.failNotAllowed = true; }
		}
		
		if(!this.failNotAllowed)
		{
			//see if student answer contains all the required strings
			for( i=0; i<this.settings.mustHave.strings.length; i++ )
			{
				if(!this.studentAnswer.contains(this.settings.mustHave.strings[i])) { this.failMustHave = true; }
			}
		}

		//calculate how many marks will be given for a correct answer
		//(can be modified if answer wrong length or fails string restrictions)
		this.setCredit(1,'Your answer is correct.');

		if(this.failMinLength)
		{
			this.multCredit(this.settings.minLength.partialCredit,this.settings.minLength.message);
		}
		if(this.failMaxLength)
		{
			this.multCredit(this.settings.maxLength.partialCredit,this.settings.maxLength.message);
		}

		if(this.failMustHave)
		{
			if(this.settings.mustHave.showStrings)
			{
				this.addCredit(0,'Your answer must contain all of: <span class="monospace">'+this.settings.mustHave.strings.join('</span>, <span class="monospace">')+'</span>');
			}
			this.multCredit(this.settings.mustHave.partialCredit,this.settings.mustHave.message);
		}

		if(this.failNotAllowed)
		{
			if(this.settings.notAllowed.showStrings)
			{
				this.addCredit(0,'Your answer must not contain any of: <span class="monospace">'+this.settings.notAllowed.string.sjoin('</span>, <span class="monospace">')+'</span>');
			}
			this.multCredit(this.settings.notAllowed.partialCredit,this.settings.notAllowed.message);
		}

	},

	validate: function()
	{
		if(this.studentAnswer.length===0)
		{
			this.giveWarning("No answer submitted.");
			return false;
		}

		try{
			var tree = jme.compile(this.studentAnswer);
			var varnames = jme.findvars(tree);
			var vars = {}
			for(i=0;i<varnames.length;i++)
			{
				vars[varnames[i]]=jme.types.TNum(0);
			}
			jme.evaluate(tree,vars,this.question.functions);
		}
		catch(e)
		{
			this.giveWarning("This is not a valid mathematical expression.\n\n"+e.message);
			return false;
		}

		if( this.failMinLength)
		{
			this.giveWarning(this.settings.minLength.message);
		}

		if( this.failMaxLength )
		{
			this.giveWarning(this.settings.maxLength.message);
		}

		if( this.failMustHave )
		{
			this.giveWarning(this.settings.mustHave.message);
			if(this.settings.mustHaveShowStrings)
			{
				this.giveWarning('Your answer must contain all of: <span class="monospace">'+this.settings.mustHave.strings.join('</span>, <span class="monospace">')+'</span>');
			}
		}

		if( this.failNotAllowed )
		{
			this.giveWarning(this.settings.notAllowed.message);
			if(this.settings.notAllowedShowStrings)
			{
				this.giveWarning('Your answer must not contain any of: <span class="monospace">'+this.settings.notAllowed.strings.join('</span>, <span class="monospace">')+'</span>');
			}
		}

		return true;
	}
};
JMEPart.prototype.subvars = util.extend(Part.prototype.subvars,JMEPart.prototype.subvars);


function PatternMatchPart(json, path, question, parentPart, loading)
{
	var settings = this.settings;
	util.copyinto(PatternMatchPart.prototype.settings,settings);

	['correctAnswer','displayAnswer','caseSensitive','partialCredit'].map(Numbas.json.tryLoad('',settings,json));

	this.display = new Numbas.display.PatternMatchPartDisplay(this);

	if(loading)
	{
		var pobj = Numbas.store.loadPart(this);
		this.studentAnswer = pobj.studentAnswer;
	}
}
PatternMatchPart.prototype = {
	studentAnswer: '',

	settings: 
	{
		correctAnswer: /.*/,
		displayAnswer: '',
		caseSensitive: false,
		partialCredit: 0
	},

	subvars: function() {
		this.correctAnswer = jme.subvars(this.settings.correctAnswer,this.question.variables,this.question.functions);
	},

	mark: function ()
	{
		if(this.answerList==undefined)
		{
			this.setCredit(0,'You did not enter an answer.');
			return false;
		}
		this.studentAnswer = this.answerList[0];
		this.answered = this.studentAnswer.length>0;

		var caseInsensitiveAnswer = new RegExp( this.correctAnswer, 'i' );			
		var caseSensitiveAnswer = new RegExp( this.correctAnswer );
		
		if( this.settings.caseSensitive )
		{
			if( caseSensitiveAnswer.test(this.studentAnswer) )
			{
				this.setCredit(1,'Your answer is correct.');
			}
			else if(caseInsensitiveAnswer.test(this.studentAnswer))
			{
				this.setCredit(this.settings.partialCredit,'Your answer is correct, except for the case.');
			}
			else
			{
				this.setCredit(0,'Your answer is incorrect.');
			}
		}else{
			if(caseInsensitiveAnswer.test(this.studentAnswer))
			{
				this.setCredit(1,'Your answer is correct.');
			}
			else
			{
				this.setCredit(0,'Your answer is incorrect.');
			}
		}
	},

	validate: function()
	{
		if(!this.answered)
			this.giveWarning("No answer submitted.");

		return this.answered;
	}
};
PatternMatchPart.prototype.subvars = util.extend(Part.prototype.subvars,PatternMatchPart.prototype.subvars);

function NumberEntryPart(json, path, question, parentPart, loading)
{
	var settings = this.settings;
	util.copyinto(NumberEntryPart.prototype.settings,settings);

	['minValue','maxValue','inputStep','integerAnswer','partialCredit'].map(Numbas.json.tryLoad('answer',settings,json));

	this.display = new Numbas.display.NumberEntryPartDisplay(this);
	
	if(loading)
	{
		var pobj = Numbas.store.loadPart(this);
		this.studentAnswer = pobj.studentAnswer;
	}
}
NumberEntryPart.prototype =
{
	studentAnswer: '',

	settings:
	{
		inputStep: 1,
		minvalue: 0,
		maxvalue: 0,
		integerAnswer: false,	//must answer be an integer?
		partialCredit: 0,		//partial credit to award if answer is not an integer
	},

	subvars: function() {
		this.maxValue = jme.evaluate(jme.subvars(this.settings.maxValue,this.question.variables,this.question.functions),this.question.variables,this.question.functions);
		this.minValue = jme.evaluate(jme.subvars(this.settings.minValue,this.question.variables,this.question.functions),this.question.variables,this.question.functions);
	},

	mark: function()
	{
		if(this.answerList==undefined)
		{
			this.setCredit(0,'You did not enter an answer.');
			return false;
		}
		this.studentAnswer = this.answerList[0];
		
		// do a bit of string tidy up
		// uk number format only for now - get rid of any UK 1000 separators	
		this.studentAnswer = this.studentAnswer.replace(/,/g, '');
		this.studentAnswer = $.trim(this.studentAnswer);
		
		if( this.studentAnswer.length>0 && !isNaN(this.studentAnswer) )
		{
			this.studentAnswer = parseFloat(this.studentAnswer);

			if( this.studentAnswer <= this.maxValue && this.studentAnswer >= this.minValue )
			{
				if(this.settings.integerAnswer && !util.isInt(this.studentAnswer))
					this.setCredit(this.settings.partialCredit,'Your answer is within the allowed range, but decimal numbers are not allowed.');
				else
					this.setCredit(1,'Your answer is correct.');
			}else{
				this.setCredit(0,'Your answer is incorrect.');
			}
			this.answered = true;
		}else{
			this.answered = false;
			this.setCredit(0,'You did not enter a valid number.');
		}
	},

	validate: function()
	{
		if(!this.answered)
			this.giveWarning("No answer submitted.");
		
		return this.answered;
	}
};
NumberEntryPart.prototype.subvars = util.extend(Part.prototype.subvars,NumberEntryPart.prototype.subvars);


function MultipleResponsePart(json, path, question, parentPart, loading)
{
	var settings = this.settings;
	util.copyinto(MultipleResponsePart.prototype.settings,settings);


	//work out marks available
	if('maxMarks' in json)
	{
		this.marks = json.maxMarks;
	}
	if('minMarks' in json)
	{
		this.minMarks = json.minMarks;
	}

	['minAnswers','maxAnswers','shuffleChoices','shuffleAnswers','displayType'].map(Numbas.json.tryLoad('',settings,json));

	this.numChoices = json.choices.length;
	this.numAnswers = json.answers.length;

	if(loading)
	{
		var pobj = Numbas.store.loadPart(this);
		this.choiceOrder = pobj.choiceOrder;
		this.answerOrder = pobj.answerOrder;
	}
	else
	{

		this.choiceOrder=[];
		if(settings.shuffleChoices)
		{
			this.choiceOrder = Numbas.math.deal(this.numChoices);
		}
		else
		{
			this.choiceOrder = Numbas.math.range(this.numChoices);
		}

		this.answerOrder=[];
		if(settings.shuffleAnswers)
		{
			this.answerOrder = Numbas.math.deal(this.numAnswers);
		}
		else
		{
			this.answerOrder = Numbas.math.range(this.numAnswers);
		}
	}

	//load answers and choices in right order
	var choices = this.settings.rawchoices = [];
	this.choices = new Array(this.numChoices);
	for(var i=0;i<this.numChoices;i++)
	{
		choices.push(json.choices[this.choiceOrder[i]]);
	}
	var answers = this.settings.rawanswers = [];
	this.answers = new Array(this.numAnswers);
	for(var i=0;i<this.numAnswers;i++)
	{
		answers.push(json.answers[this.answerOrder[i]]);
	}

	//invert the shuffle so we can now tell where particular choices/answers went
	this.choiceOrder = Numbas.math.inverse(this.choiceOrder);
	this.answerOrder = Numbas.math.inverse(this.answerOrder);

	//fill marks matrix and load distractor messages
	var matrix=[];
	var rawmatrix = this.settings.rawmatrix = [];
	var matrixTotal = 0;
	var distractors=[];
	var rawdistractors = this.settings.rawdistractors = [];
	for( i=0; i<this.numAnswers; i++ )
	{
		for( var j=0; j<this.numChoices; j++ )
		{
			var value = jme.evaluate(jme.subvars(json.matrix[i][j],this.question.variables,this.question.functions),this.question.variables,this.question.functions);
			matrixTotal += value;

			//take into account shuffling
			var ii = this.answerOrder[i];
			var jj = this.choiceOrder[j];

			if(this.type == '1_n_2' || this.type == 'm_n_2')
			{
				ii = jj;
				jj = 0;
			}

			if(!matrix[ii])
				matrix[ii]=[];
			matrix[ii][jj] = value;

			if(!rawmatrix[ii])
				rawmatrix[ii] = [];
			rawmatrix[ii][jj] = value;

			var message= json.distractors[i][j];
			if(!distractors[ii])
				distractors[ii]=[];
			distractors[ii][jj] = message;
			if(!rawdistractors[ii])
				rawdistractors[ii]=[];
			rawdistractors[ii][jj] = message;
		}
	}
	settings.matrix = matrix;
	settings.distractors = distractors;
	
	if(this.marks == 0)
		this.marks = matrixTotal;

	if(this.type == '1_n_2' || this.type == 'm_n_2')
	{	//because we swapped answers and choices round in the marking matrix
		this.numAnswers = this.numChoices;
		this.numChoices = 1;
		this.settings.rawanswers = this.settings.rawchoices;
		this.settings.rawchoices = [''];
		var flipped=true;
	}
	else
		var flipped=false;

	//ticks array - which answers/choices are selected?
	this.ticks=[];
	this.stagedAnswer = [];
	for( i=0; i<this.numAnswers; i++ )
	{
		this.ticks.push([]);
		this.stagedAnswer.push([]);
		for( var j=0; j<this.numChoices; j++ )
		{
			this.ticks[i].push(false);
			this.stagedAnswer[i].push(false);
		}
	}

	//restore saved choices
	if(loading)
	{
		for( i=0;i<this.numAnswers;i++)
		{
			for(j=0;j<this.numChoices;j++)
			{
				if( (flipped && (pobj.ticks[j][i])) || (!flipped && pobj.ticks[i][j]) )
					this.ticks[i][j]=true;
			}
		}
	}

	//if this part has a minimum number of answers more than zero, then
	//we start in an error state
	this.wrongNumber = settings.minAnswers > 0;

	this.display = new Numbas.display.MultipleResponsePartDisplay(this);
}
MultipleResponsePart.prototype =
{
	ticks: [],						//store student's responses here - array to say if each response has been selected or not
	wrongNumber: false,				//has student given the wrong number of responses?

	settings:
	{
		minMarks: 0,				//minimum number of marks student can be awarded
		minAnswers: 0,				//minimum number of responses student must select
		maxAnswers: 0,				//maximum ditto
		shuffleChoices: false,		//randomise order of choices?
		shuffleAnswers: false,		//randomise order of answers?
		matrix: [],					//marks matrix
		displayType: '',			//how to display the responses? can be: radiogroup, dropdownlist, buttonimage, checkbox, choicecontent
		numChoices: 0,				//number of choices
		numAnswers: 0,				//number of possible answers
		warningType: '',			//what to do if wrong number of responses
		warningMessage: ''			//message to display if wrong number of responses
	},

	subvars: function() {
		for(var i=0;i<this.settings.rawmatrix.length;i++)
		{
			for(var j=0;j<this.settings.rawmatrix[i].length;j++)
			{
				this.settings.matrix[i][j] = jme.subvars(this.settings.rawmatrix[i][j],this.question.variables,this.question.functions);
				this.settings.distractors[i][j] = jme.subvars(this.settings.rawdistractors[i][j],this.question.variables,this.question.functions);
			}
		}
		for(var i=0;i<this.numChoices;i++)
			this.choices[i] = jme.subvars(this.settings.rawchoices[i],this.question.variables,this.question.functions);
		for(var i=0;i<this.numAnswers;i++)
			this.answers[i] = jme.subvars(this.settings.rawanswers[i],this.question.variables,this.question.functions);
	},

	storeAnswer: function(answerList)
	{
		//get choice and answer 
		//in MR1_n_2 and MRm_n_2 parts, only the choiceindex matters
		var answerIndex = answerList[0];
		var choiceIndex = answerList[1];

		switch(this.settings.displayType)
		{
		case 'radiogroup':							//for radiogroup parts, only one answer can be selected.
		case 'dropdownlist':
			for(var i=0; i<this.numAnswers; i++)
			{
				this.stagedAnswer[i][choiceIndex]= i==answerIndex;
			}
			break;
		default:
			this.stagedAnswer[answerIndex][choiceIndex] = answerList[2];
		}
	},

	mark: function()
	{
		if(this.stagedAnswer==undefined)
		{
			this.setCredit(0,'You did not answer this part.');
			return false;
		}
		this.ticks = util.copyarray(this.stagedAnswer);
		this.setCredit(0);

		this.numTicks = 0;
		var partScore = 0;
		for( i=0; i<this.numAnswers; i++ )
		{
			for(var j=0; j<this.numChoices; j++ )
			{
				if(this.ticks[i][j])
				{
					partScore += this.settings.matrix[i][j];
					this.numTicks += 1;

					if((row = this.settings.distractors[i]) && (message=row[j]))
						this.addCredit(this.settings.matrix[i][j]/this.marks,message);
				}
			}
		}

		this.wrongNumber = (this.numTicks<this.settings.minAnswers || (this.numTicks>this.settings.maxAnswers && this.settings.maxAnswers>0));

		if(this.marks>0 && !this.wrongNumber)
		{
			partScore = Math.min(Math.max(partScore,this.minMarks),this.marks); //this part might have a maximum number of marks which is less then the sum of the marking matrix
			this.setCredit(partScore/this.marks);	
		}
		else
			this.setCredit(0,'You selected the wrong number of choices.');
	},

	validate: function()
	{
		if(this.wrongNumber)
		{
			switch(this.settings.warningType)
			{
			case 'prevent':
				this.giveWarning(this.settings.warningMessage);
				return false;
				break;
			case 'warn':
				this.giveWarning(this.settings.warningMessage);
				break;
			}
		}

		if(this.numTicks>0)
			return true;
		else
			this.giveWarning('No choices selected.');
			return false;
	}
};
MultipleResponsePart.prototype.subvars = util.extend(Part.prototype.subvars,MultipleResponsePart.prototype.subvars);

function GapFillPart(json, path, question, parentPart, loading)
{
	this.marks = 0;
	this.gaps = [];

	for( var i=0 ; i<json.gaps.length; i++ )
	{
		var gap = createPart(json.gaps[i], path+'g'+i, this.question, this, loading);
		gap.isGap = true;
		this.marks += gap.marks;
		this.gaps[i]=gap;
	}

	this.display = new Numbas.display.GapFillPartDisplay(this);
}	
GapFillPart.prototype =
{
	stagedAnswer: 'something',

	subvars: function() {
		for(var i=0;i<this.gaps.length;i++)
		{
			this.gaps[i].subvars();
		}

		//insert gapfills in prompt
		var p = this;
		this.prompt = this.prompt.replace(/\[\[(\d+)\]\]/,function(match,n) {
			n = parseInt(n);
			return p.gaps[n].display.render().trim();
		});
	},

	revealAnswer: function()
	{
		for(var i=0; i<this.gaps.length; i++)
			this.gaps[i].revealAnswer();
	},

	submit: function()
	{
		this.submitting = true;
		for(var i=0;i<this.gaps.length;i++)
		{
			this.gaps[i].submit();
		}
		this.submitting = false;
	},

	mark: function()
	{
		this.credit=0;
		if(this.marks>0)
		{
			for(var i=0; i<this.gaps.length; i++)
			{
				var gap = this.gaps[i];
				this.credit += gap.credit*gap.marks;
				if(this.gaps.length>1)
					this.markingComment('*Gap '+(i+1)+'*');
				for(var j=0;j<gap.markingFeedback.length;j++)
				{
					var action = util.copyobj(gap.markingFeedback[j]);
					action.gap = i;
					this.markingFeedback.push(action);
				}
			}
			this.credit/=this.marks;
		}
	},


	validate: function()
	{
		//go through all gaps, and if any one fails to validate then
		//whole part fails to validate
		var success = true;
		for(var i=0; i<this.gaps.length; i++)
			success = success && this.gaps[i].answered;

		return success;
	}
};
GapFillPart.prototype.submit = util.extend(GapFillPart.prototype.submit, Part.prototype.submit);
GapFillPart.prototype.revealAnswer = util.extend(GapFillPart.prototype.revealAnswer, Part.prototype.revealAnswer);
GapFillPart.prototype.subvars = util.extend(Part.prototype.subvars,GapFillPart.prototype.subvars);

function InformationPart(json, path, question, parentPart, loading)
{
	this.display = new Numbas.display.InformationPartDisplay(this);
}
InformationPart.prototype = {
	validate: function() {
		return true;
	}
};


//associate part type names with their object constructors
var partConstructors = Numbas.Question.partConstructors = {
	'CUEdt.JMEPart': JMEPart, 
	'jme': JMEPart,

	'CUEdt.PatternMatchPart': PatternMatchPart,
	'patternmatch': PatternMatchPart,

	'CUEdt.NumberEntryPart': NumberEntryPart,
	'numberentry': NumberEntryPart,

	'CUEdt.MR1_n_2Part': MultipleResponsePart,
	'CUEdt.MRm_n_2Part': MultipleResponsePart,
	'CUEdt.MRm_n_xPart': MultipleResponsePart,
	'1_n_2': MultipleResponsePart,
	'm_n_2': MultipleResponsePart,
	'm_n_x': MultipleResponsePart,

	'CUEdt.GapFillPart': GapFillPart,
	'gapfill': GapFillPart,

	'CUEdt.InformationOnlyPart': InformationPart,
	'information': InformationPart
};

var extend = util.extend;
for(var pc in partConstructors)
	partConstructors[pc]=extend(Part,partConstructors[pc]);

});
