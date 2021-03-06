/*
Copyright 2011-13 Newcastle University

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


Numbas.queueScript('scorm-storage',['base','SCORM_API_wrapper','storage'],function() {
Numbas.storage.clean = function()
{
	for(x in localStorage) delete localStorage[x];
};

Numbas.storage.startLMS = function()
//tries to initialise the SCORM API
//if it isn't present, a pretend LMS is started
//(this could save student progress in localStorage)
{
};

//SCORM storage object - controls saving and loading of data from the LMS
var SCORMStorage = Numbas.storage.SCORMStorage = function()
{
	if(!pipwerks.SCORM.init())
	{
		//if the pretend LMS extension is loaded, we can start that up
		if(Numbas.storage.PretendLMS)
		{
			if(!Numbas.storage.lms)
			{
				Numbas.storage.lms = new Numbas.storage.PretendLMS();
			}
			window.API_1484_11 = Numbas.storage.lms.API;
			pipwerks.SCORM.init();
		}
		//otherwise return a blank storage object which does nothing
		else
		{
			return new Numbas.storage.BlankStorage();	
		}
	}

	this.getEntry();

	//get all question-objective indices
	this.questionIndices = {};
	var numObjectives = parseInt(this.get('objectives._count'),10);
	for(var i=0;i<numObjectives;i++)
	{
		var id = this.get('objectives.'+i+'.id');
		this.questionIndices[id]=i;
	}

	//get part-interaction indices
	this.partIndices = {};
	var numInteractions = parseInt(this.get('interactions._count'),10);
	for(var i=0;i<numInteractions;i++)
	{
		var id = this.get('interactions.'+i+'.id');
		this.partIndices[id]=i;
	}
};

SCORMStorage.prototype = {
	mode: 'ab-initio',		//'ab-initio' - starting new attempt; 'resume': load incomplete exam from storage
	e: undefined,			//reference to the main exam object
	examstore: undefined,	//exam info storage object
	id: '',					//id to be prepended to all saved data so we don't overlap with other apps
	questionIndices:{},		//associate question ids with objective indices
	partIndices:{},			//associate part ids with interaction indices
	suspendData: undefined,	//save the suspend data so we don't have to keep fetching it off the server
	
	obj: {
		score: 0,
		passed: false,
		numQuestions: 0,
		questionSubset: [],
		timeRemaining: 0,
		start: undefined,
		status: 'incomplete',
		bookmark: 0
	},

	save: function()
	{
		var exam = this.e;
		function trySave() {
			exam.display.saving(true);
			var saved = pipwerks.SCORM.save();

			if(!saved) {
				Numbas.display.showAlert(R('scorm.failed save'),function(){
					setTimeout(trySave,1);
				});
			}
			else
				exam.display.saving(false);
		}
		trySave();
	},

	set: function(key,value)
	{
		//Numbas.debug("set "+key+" := "+value,true);
		var val = pipwerks.SCORM.set('cmi.'+key,value);
		//Numbas.debug(pipwerks.SCORM.debug.getCode(),true);
		return val;
	},

	get: function(key)
	{
		var val = pipwerks.SCORM.get('cmi.'+key);
		//Numbas.debug("get "+key+" = "+val,true);
		//Numbas.debug(pipwerks.SCORM.debug.getCode(),true);
		return val;
	},

	//make an id string corresponding to a question
	getQuestionId: function(question)
	{
		return 'q'+question.number;
	},

	//make an id string corresponding to a part
	getPartId: function(part)
	{
		return this.getQuestionId(part.question)+part.path;
	},

	//
	//Storage methods
	//

	//when starting a new exam, must initialise storage
	//pass in ref to exam object because global var will not be set yet
	init: function(exam)
	{
		this.e=exam;

		var set = this.set;

		this.set('completion_status','incomplete');
		this.set('exit','suspend');
		this.set('progress_measure',0);
		this.set('session_time','PT0H0M0S');
		this.set('success_status','unknown');
		this.set('score.scaled',0);
		this.set('score.raw',0);
		this.set('score.min',0);
		this.set('score.max',exam.mark);

		this.questionIndices = {};
		this.partIndices = {};

		for(var i=0; i<exam.settings.numQuestions; i++)
		{
			this.initQuestion(exam.questionList[i]);
		}

		this.setSuspendData();
	},

	//initialise a question
	initQuestion: function(q)
	{
		var id = this.getQuestionId(q);

		var index = this.get('objectives._count');
		this.questionIndices[id] = index;

		var prepath = 'objectives.'+index+'.';

		this.set(prepath+'id', id);
		this.set(prepath+'score.min',0);
		this.set(prepath+'score.max',q.marks);
		this.set(prepath+'score.raw',q.score || 0);
		this.set(prepath+'success_status','unknown');
		this.set(prepath+'completion_status','not attempted');
		this.set(prepath+'progress_measure',0);
		this.set(prepath+'description',q.name);

		for(var i=0; i<q.parts.length;i++)
		{
			this.initPart(q.parts[i]);
		}
	},

	//initialise a part
	initPart: function(p)
	{
		var id = this.getPartId(p);

		var index = this.get('interactions._count');
		this.partIndices[id] = index;

		var prepath = 'interactions.'+index+'.';

		this.set(prepath+'id',id);
		this.set(prepath+'objectives.0.id',this.getQuestionId(p.question));
		this.set(prepath+'weighting',p.marks);
		this.set(prepath+'result',0);
		this.set(prepath+'description',p.type);
		switch(p.type)
		{
		case '1_n_2':
		case 'm_n_2':
		case 'm_n_x':
			this.set(prepath+'type','choice');
			
			var pattern='';
			for(var i=0;i<p.settings.matrix.length;i++)
			{
				for(var j=0;j<p.settings.matrix[i].length;j++)
				{
					if(p.settings.matrix[i][j]>0)
					{
						if(pattern.length>0){pattern+='[,]';}
						pattern+=i+'-'+j;
					}
				}
			}
			this.set(prepath+'correct_responses.0.pattern',pattern);

			break;
		case 'numberentry':
			this.set(prepath+'type','numeric');
			this.set(prepath+'correct_responses.0.pattern',Numbas.math.niceNumber(p.settings.minvalue)+'[:]'+Numbas.math.niceNumber(p.settings.maxvalue));
			break;
		case 'patternmatch':
			this.set(prepath+'type','fill-in');
			this.set(prepath+'correct_responses.0.pattern','{case_matters='+p.settings.caseSensitive+'}{order_matters=false}'+p.settings.correctAnswer);
			break;
		case 'jme':
			this.set(prepath+'type','fill-in');
			this.set(prepath+'correct_responses.0.pattern','{case_matters=false}{order_matters=false}'+p.settings.correctAnswer);
			break;
		case 'gapfill':
			this.set(prepath+'type','other');

			for(var i=0;i<p.gaps.length;i++)
			{
				this.initPart(p.gaps[i]);
			}
			break;
		}

		for(var i=0;i<p.steps.length;i++)
		{
			this.initPart(p.steps[i]);
		}
	},


	//save all the other stuff that doesn't fit into SCORM using the suspend_data string.
	setSuspendData: function()
	{
		var exam = this.e;
		if(exam.loading)
			return;
		var eobj = 
		{
			timeRemaining: exam.timeRemaining,
			questionSubset: exam.questionSubset,
			start: exam.start
		};

		eobj.questions = [];
		for(var i=0;i<exam.settings.numQuestions;i++)
		{
			eobj.questions.push(this.questionSuspendData(exam.questionList[i]));
		}
		
		this.set('suspend_data',JSON.stringify(eobj));
		this.suspendData = eobj;
	},

	//create suspend data object for a question
	questionSuspendData: function(question)
	{
		var qobj = 
		{
			visited: question.visited,
			answered: question.answered,
			submitted: question.submitted,
			adviceDisplayed: question.adviceDisplayed,
			revealed: question.revealed
		};

		qobj.variables = {};
		for(var name in question.scope.variables)
		{
			qobj.variables[name] = Numbas.jme.display.treeToJME({tok: question.scope.variables[name]},{});
		}

		qobj.parts = [];
		for(var i=0;i<question.parts.length;i++)
		{
			qobj.parts.push(this.partSuspendData(question.parts[i]));
		}

		return qobj;
	},

	partSuspendData: function(part)
	{
		var pobj = {
			answered: part.answered,
			stepsShown: part.stepsShown,
			stepsOpen: part.stepsOpen
		};
		switch(part.type)
		{
		case 'gapfill':
			pobj.gaps=[];
			for(var i=0;i<part.gaps.length;i++)
			{
				pobj.gaps.push(this.partSuspendData(part.gaps[i]));
			}
			break;
		case '1_n_2':
		case 'm_n_2':
		case 'm_n_x':
			pobj.shuffleChoices = part.shuffleChoices;
			pobj.shuffleAnswers = part.shuffleAnswers;
			break;
		}

		pobj.steps = [];
		for(var i=0;i<part.steps.length;i++)
		{
			pobj.steps.push(this.partSuspendData(part.steps[i]));
		}

		return pobj;
	},

	getSuspendData: function()
	{
		if(!this.suspendData)
		{
			var suspend_data = this.get('suspend_data');
			if(suspend_data.length)
				this.suspendData = JSON.parse(suspend_data);
		}
		return this.suspendData;
	},

	//get suspended exam info
	//returns an object 
	//{ timeRemaining, questionSubset, start, score }
	load: function(exam) 
	{
		this.e = exam;
		var eobj = this.getSuspendData();
		this.set('exit','suspend');
		
		var currentQuestion = this.get('location');
		if(currentQuestion.length)
			currentQuestion=parseInt(currentQuestion,10);
		else
			currentQuestion=undefined;

		var score = parseInt(this.get('score.raw'),10);

		return {timeRemaining: eobj.timeRemaining,
				questionSubset: eobj.questionSubset,
				start: eobj.start,
				score: score,
				currentQuestion: currentQuestion
		};
	},

	//get suspended info for a question
	//questionNumber is the one in exam.questionSubset, not the original order
	loadQuestion: function(question) 
	{
		var eobj = this.getSuspendData();
		var qobj = eobj.questions[question.number];
		var id = this.getQuestionId(question);
		var index = this.questionIndices[id];

		var variables = {};
		for(var name in qobj.variables)
		{
			variables[name] = Numbas.jme.evaluate(qobj.variables[name],question.scope);
		}

		return {score: parseInt(this.get('objectives.'+index+'.score.raw') || 0,10),
				visited: qobj.visited,
				answered: qobj.answered,
				submitted: qobj.submitted,
				adviceDisplayed: qobj.adviceDisplayed,
				revealed: qobj.revealed,
				variables: variables
		};
	},

	//get suspended info for a part
	loadPart: function(part)
	{
		var eobj = this.getSuspendData();
		var pobj = eobj.questions[part.question.number];
		var re = /(p|g|s)(\d+)/g;
		while(m = re.exec(part.path))
		{
			var i = parseInt(m[2]);
			switch(m[1])
			{
			case 'p':
				pobj = pobj.parts[i];
				break;
			case 'g':
				pobj = pobj.gaps[i];
				break;
			case 's':
				pobj = pobj.steps[i];
				break;
			}
		}

		var id = this.getPartId( part );
		var index = this.partIndices[id];
		var sc = this;
		function get(key) { return sc.get('interactions.'+index+'.'+key); };

		pobj.answer = get('learner_response');

		return pobj;
	},

	loadJMEPart: function(part)
	{
		var out = this.loadPart(part);
		out.studentAnswer = out.answer || '';
		return out;
	},
	loadPatternMatchPart: function(part)
	{
		var out = this.loadPart(part);
		out.studentAnswer = out.answer || '';
		return out;
	},
	loadNumberEntryPart: function(part)
	{
		var out = this.loadPart(part);
		out.studentAnswer = parseFloat(out.answer)==out.answer ? parseFloat(out.answer) : '';
		return out;
	},
	loadMultipleResponsePart: function(part)
	{
		var out = this.loadPart(part);

		if(part.numAnswers===undefined)
			return out;
		var ticks = [];
		var w = part.type=='m_n_x' ? part.numAnswers : part.numChoices;
		var h = part.type=='m_n_x' ? part.numChoices : part.numAnswers;
		if(w==0 || h==0)
			return;
		for(var i=0;i<w;i++)
		{
			ticks.push([]);
			for(var j=0;j<h;j++)
			{
				ticks[i].push(false);
			}
		}
		var tick_re=/(\d+)-(\d+)/;
		var bits = out.answer.split('[,]');
		for(var i=0;i<bits.length;i++)
		{
			var m = bits[i].match(tick_re);
			if(m)
			{
				var x = parseInt(m[1],10);
				var y = parseInt(m[2],10);
				ticks[x][y]=true;
			}
		}
		out.ticks = ticks;
		return out;
	},

	//record duration of current session
	setSessionTime: function()
	{
		var timeSpent = new Date((this.e.duration - this.e.timeRemaining)*1000);
		var sessionTime = 'PT'+timeSpent.getHours()+'H'+timeSpent.getMinutes()+'M'+timeSpent.getSeconds()+'S';
		this.set('session_time',sessionTime);
	},


	//this is called when the exam is started (when the "start exam" button is pressed, not when the page is loaded
	start: function() 
	{
		this.set('completion_status','incomplete');
	},

	//this is called when the exam is paused
	pause: function() 
	{
		this.setSuspendData();
	},

	//this is called when the exam is resumed
	resume: function() {},

	//this is called when the exam is ended
	end: function()
	{
		this.setSessionTime();
		this.set('success_status',this.e.passed ? 'passed' : 'failed');
		this.set('completion_status','completed');
		pipwerks.SCORM.quit();
	},

	//get entry state: 'ab-initio' or 'resume'
	getEntry: function() 
	{
		return this.get('entry');
	},

	//get viewing mode: 
	// 'browse' - see exam info, not questions
	// 'normal' - sit exam
	// 'review' - look at answers
	getMode: function() 
	{
		return this.get('mode');
	},

	//called when question is changed
	changeQuestion: function(question)
	{
		this.set('location',question.number);	//set bookmark
		this.setSuspendData();	//because currentQuestion.visited has changed
	},

	//called when a part is answered
	partAnswered: function(part)
	{
		var id = this.getPartId(part);
		var index = this.partIndices[id];

		var prepath = 'interactions.'+index+'.';

		this.set(prepath+'result',part.score);

		switch(part.type)
		{
		case 'jme':
			this.set(prepath+'learner_response',part.studentAnswer);
			break;
		case 'patternmatch':
			this.set(prepath+'learner_response',part.studentAnswer);
			break;
		case 'numberentry':
			this.set(prepath+'learner_response',part.studentAnswer);
			break;
		case '1_n_2':
		case 'm_n_2':
		case 'm_n_x':
			var s='';
			for(var i=0;i<part.numAnswers;i++)
			{
				for( var j=0;j<part.numChoices;j++ )
				{
					if(part.ticks[i][j])
					{
						if(s.length){s+='[,]';}
						s+=i+'-'+j;
					}
				}
			}
			this.set(prepath+'learner_response',s);
			break;
		}
		this.setSuspendData();
	},

	saveExam: function(exam)
	{
		if(exam.loading)
			return;

		//update total exam score and so on
		this.set('score.raw',exam.score);
		this.set('score.scaled',exam.score/exam.mark || 0);
	},

	//called when current question is submitted
	saveQuestion: function(question) 
	{
		if(question.exam.loading)
			return;

		var id = this.getQuestionId(question);

		if(!(id in this.questionIndices))
			return;

		var index = this.questionIndices[id];


		var prepath = 'objectives.'+index+'.';

		this.set(prepath+'score.raw',question.score);
		this.set(prepath+'score.scaled',question.score/question.marks || 0);
		this.set(prepath+'success_status', question.score==question.marks ? 'passed' : 'failed' );
		this.set(prepath+'completion_status', question.answered ? 'completed' : 'incomplete' );
	},

	//record that a question has been submitted
	questionSubmitted: function(question)
	{
		this.save();
	},

	//record that the student displayed question advice
	adviceDisplayed: function(question)
	{
		this.setSuspendData();
	},

	//record that the student revealed the answer to a question
	answerRevealed: function(question)
	{
		this.setSuspendData();
		this.save();
	},

	//record that the student showed the steps for a part
	stepsShown: function(part)
	{
		this.setSuspendData();
		this.save();
	},
	
	//record that the student hid the steps for a part
	stepsHidden: function(part)
	{
		this.setSuspendData();
		this.save();
	}
	
};

});
